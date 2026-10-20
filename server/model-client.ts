export async function generateWithBoundedFallback(
  ai: {models:{generateContent:(input:any)=>Promise<{text?:string}>}}, requestedModel:string, fallbackModel:string|string[],
  contents:any[], temperature:number, timeoutMs=90_000, externalSignal?:AbortSignal,
) {
  const deadline=Date.now()+Math.max(100,timeoutMs),models=[...new Set([requestedModel,...(Array.isArray(fallbackModel)?fallbackModel:[fallbackModel])].filter(Boolean))];
  if(!models.length)throw new Error('Configure a model before requesting AI output.');
  let failure:unknown;
  for(const model of models){
    if(externalSignal?.aborted)throw new Error('Operation cancelled.');
    const remaining=deadline-Date.now();if(remaining<=0)throw new Error('The AI request reached its total time limit. No output was confirmed.');
    const limit=AbortSignal.timeout(Math.min(remaining,30_000));
    const signal=externalSignal?AbortSignal.any([externalSignal,limit]):limit;
    try{
      const response=await ai.models.generateContent({model,contents,config:{temperature,abortSignal:signal}});
      if(externalSignal?.aborted)throw new Error('Operation cancelled.');
      if(signal.aborted)throw new Error('The model request timed out.');
      if(!response.text?.trim())throw new Error('The model returned no usable text.');
      return {text:response.text,modelUsed:model,fallback:model!==requestedModel,warning:model!==requestedModel?`Model ${requestedModel} did not answer; configured fallback ${model} was used.`:undefined};
    }catch(error){failure=error;if(externalSignal?.aborted)throw new Error('Operation cancelled.');}
  }
  throw new Error(`The configured models did not return usable output. ${String((failure as Error)?.message||failure).slice(0,450)}`);
}
