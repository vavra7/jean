import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { ChatOpenAI } from '@langchain/openai'

const State = Annotation.Root({
  text: Annotation<string>(),
})

const llm = async (state: typeof State.State) => {
  const apiKey = process.env.NVIDIA_API_KEY
  if (!apiKey) throw new Error('NVIDIA_API_KEY is not set')

  const model = new ChatOpenAI({
    apiKey,
    model: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
    configuration: { baseURL: 'https://integrate.api.nvidia.com/v1' },
    temperature: 1,
    topP: 0.95,
    maxTokens: 2048,
    modelKwargs: { reasoning_effort: 'low' },
  })

  const response = await model.invoke(state.text)
  const content = response.content

  return {
    text: typeof content === 'string' ? content : JSON.stringify(content),
  }
}

export const graph = new StateGraph(State)
  .addNode('llm', llm)
  .addEdge(START, 'llm')
  .addEdge('llm', END)
  .compile()
