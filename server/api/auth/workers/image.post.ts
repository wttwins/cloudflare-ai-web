import {handleErr, imageResponse, fluxImageResponse, translatePrompt} from "~/utils/helper";
import {WorkersBodyImage, WorkersReqImage} from "~/utils/types";

export default defineEventHandler(async (event) => {
    const body: WorkersReqImage = await readBody(event)
    const {model, messages, num_steps} = body

    const transPrompt = await translatePrompt(messages[0].content)
    
    const workersBody: WorkersBodyImage = {
        prompt: transPrompt,
        num_steps
    }

    const res = await fetch(`${process.env.CF_GATEWAY}/workers-ai/${model}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.CF_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(workersBody)
    })

    if (!res.ok) {
        return handleErr(res)
    }

    // 检查 model 名称是否包含 'flux'
    return model.toLowerCase().includes('flux') 
        ? fluxImageResponse(res)
        : imageResponse(res)
})

