import Fastify from 'fastify'
import { graph } from './graph.js'

const app = Fastify({ logger: true })

app.get('/hello', async () => ({ message: 'Hello, World!' }))

app.post<{ Body: { text: string } }>('/langgraph', async (request) =>
  graph.invoke({ text: request.body.text ?? '' }),
)

const port = Number(process.env.PORT ?? 3000)

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
