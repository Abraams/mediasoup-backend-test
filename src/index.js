import express from 'express'
import http from 'http'
import cors from 'cors'
import { HOST, PORT } from "./config.js"
import { initSocket } from "./socket.js"
import { createWorker } from './mediasoup-utils.js'

const app = express()
const server = http.createServer(app)

initSocket(server)
createWorker()

app.use(cors({
    origin: '*'
}))

app.get('/', (req, res) => {
    res.send('test')
})

server.listen(PORT, () => {
    console.log(`Сервер запущен ${HOST}:${PORT}`)
})
