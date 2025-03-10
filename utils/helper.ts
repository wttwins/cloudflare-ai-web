import {createParser} from "eventsource-parser";
import {getToken, isLogin} from "~/utils/tools";
import {useGlobalState} from "~/utils/store";

export const headers = {
    'Content-Type': 'text/event-stream',
} as const

export function streamResponse(res: Response, parser: (chunk: string) => string) {
    const textDecoder = new TextDecoder()
    const textEncoder = new TextEncoder()

    const readableStream = new ReadableStream({
        async start(controller) {
            const parserStream = createParser((event) => {
                if (event.type === "event") {
                    if (event.data === '[DONE]') {
                        parserStream.reset()
                        return
                    }
                    const parsed = parser(event.data)
                    controller.enqueue(textEncoder.encode(parsed))
                }
            })

            for await (const chunk of res.body as any) {
                parserStream.feed(textDecoder.decode(chunk))
            }
            controller.close()
        },
    });

    return new Response(readableStream, {
        headers
    })
}

export function openaiParser(chunk: string) {
    const data: OpenAIRes = JSON.parse(chunk)
    return data.choices[0].delta.content ?? ''
}

export function workersTextParser(chunk: string) {
    const data: WorkersRes = JSON.parse(chunk)
    return data.response
}

export function imageResponse(res: Response) {
    return new Response(res.body, {
        headers: {
            'Content-Type': 'image/png',
        }
    })
}

export async function fluxImageResponse(res: Response) {
    try {
        // 获取响应数据
        const data = await res.json()
            
        if (!data || typeof data.result.image !== 'string') {
            throw new Error('Invalid response format from Flux model')
        }

        if (!data.result.image) {
            throw new Error('No image data in response')
        }

        // 从 base64 字符串转换
        let binaryString
        try {
            binaryString = atob(data.result.image)
        } catch (e) {
            console.error('Base64 decode error:', e)
            throw new Error('Invalid base64 image data')
        }
        const img = new Uint8Array(binaryString.length)
        
        for (let i = 0; i < binaryString.length; i++) {
            const charCode = binaryString.charCodeAt(i)
            img[i] = charCode
        }
        return new Response(img, {
            headers: {
                'Content-Type': 'image/jpeg',
            }
        })
    } catch (error) {
        console.error('Flux image processing error:', error)
        return new Response(`Error processing flux image: ${(error as Error).message}`, {
            status: 500
        })
    }
}

export async function handleErr(res: Response) {
    const text = await res.text()
    console.error(res.status, res.statusText, text)
    return new Response(text, {
        status: res.status,
        statusText: res.statusText,
    })
}

const {passModal} = useGlobalState()

async function handleStream(data: ReadableStream, onStream: (data: string) => void, resolve: (value: unknown) => void) {
    const reader = data.getReader()
    const decoder = new TextDecoder()
    while (true) {
        const {value, done} = await reader.read()
        if (done) {
            resolve(null)
            break
        }
        onStream(decoder.decode(value))
    }
}

export async function basicFetch(
    path: string,
    options: RequestInit = {},
    onStream?: (data: string) => void,
) {
    const headers = new Headers(options.headers || {})
    if (isLogin()) {
        headers.set('Authorization', getToken()!)
    }
    const response = await fetch('/api/auth' + path, {
        ...options,
        headers,
    })

    if (!response.ok) {
        const text = await response.text()
        if (response.status === 401 && text === 'Password Incorrect') {
            passModal.value = true
        }
        throw new Error(response.status + ' ' + response.statusText + ' ' + text)
    }

    if (response.headers.get('Content-Type')?.includes('text/event-stream')) {
        const body = response.body
        if (body === null) {
            throw new Error('Response body is null')
        }
        if (onStream) {
            return new Promise(resolve => {
                handleStream(body, onStream, resolve)
            })
        }
    }

    if (response.headers.get('Content-Type')?.includes('image')) {
        return await response.blob()
    }
}

export function streamFetch(path: string, body: Object, onStream: (data: string) => void) {
    return basicFetch(path, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    }, onStream)
}

export function postFetch(path: string, body: Object) {
    return basicFetch(path, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    })
}

export function streamFetchWithFile(path: string, body: FormData, onStream: (data: string) => void) {
    return basicFetch(path, {
        method: "POST",
        body,
    }, onStream)
}

export async function translatePrompt(prompt: string): Promise<string> {
    try {
      const response = await postRequest('@cf/qwen/qwen1.5-14b-chat-awq', {
        messages: [
          {
            role: "system",
            content: `作为 Stable Diffusion Prompt 提示词专家，您将从关键词中创建提示，通常来自 Danbooru 等数据库。
请遵循以下规则：
1. 保持原始关键词的顺序。
2. 将中文关键词翻译成英文。
3. 添加相关的标签以增强图像质量和细节。
4. 使用逗号分隔关键词。
5. 保持简洁，避免重复。
6. 不要使用 "和" 或 "与" 等连接词。
7. 保留原始提示中的特殊字符，如 ()[]{}。
8. 不要添加 NSFW 内容。
9. 输出格式应为单行文本，不包含换行符。`
          },
          {
            role: "user",
            content: `请优化并翻译以下提示词：${prompt}`
          }
        ]
      });

      const jsonResponse = await response.json();
      return jsonResponse.result.response.trim();
    } catch (error) {
      console.error("翻译提示词时出错:", error);
      return prompt; // 如果翻译失败,返回原始提示词
    }
  }
export async function postRequest(model: string, jsonBody: any): Promise<any> {
    const url = `${process.env.CF_GATEWAY}/workers-ai/${model}`;
    const headers = {
        Authorization: `Bearer ${process.env.CF_TOKEN}`,
        'Content-Type': 'application/json'
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(jsonBody),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Cloudflare API request failed: ${response.status}`, errorText);
            throw new Error('Cloudflare API request failed');
        }

        return response;
    } catch (error) {
        console.error("Error in postRequest:", error);
        return new Response(`Failed to connect to Cloudflare API: ${(error as Error).message}`, {
            status: 500
        })
    }
}
