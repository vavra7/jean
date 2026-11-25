import Fastify from 'fastify'

const app = Fastify({ logger: true })

app.get('/hello', async () => ({ message: 'Hello, World!' }))

const port = Number(process.env.PORT ?? 3000)

try {
  await app.listen({ port, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
