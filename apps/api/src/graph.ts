import { Annotation, END, START, StateGraph } from '@langchain/langgraph'

const State = Annotation.Root({
  text: Annotation<string>(),
})

const step1 = (state: typeof State.State) => ({
  text: `${state.text} -> step1`,
})

const step2 = (state: typeof State.State) => ({
  text: `${state.text} -> step2`,
})

export const graph = new StateGraph(State)
  .addNode('step1', step1)
  .addNode('step2', step2)
  .addEdge(START, 'step1')
  .addEdge('step1', 'step2')
  .addEdge('step2', END)
  .compile()
