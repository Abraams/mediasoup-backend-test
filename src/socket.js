import { Server as IoServer } from 'socket.io'
import {
    getWorker,
    createWebRtcTransport,
    getProducerTransport,
    transportConnect,
    createProducer,
    getConsumerTransport,
    createConsumer,
    getRtpCapabilities,
    createRoom,
    setPeer,
    getPeer,
    getRoom,
    getRoomsRouter,
    addTransport,
    getAllProducers,
    getProducersInSameRoom,
    getConsumerById,
    removePeer
} from "./mediasoup-utils.js";

let io = null
let connections = null

export const getSocketIo = () => ({ io, connections })

export const initSocket = (server) => {
    if (!server) {
        return
    }

    if (io) {
        return getSocketIo()
    }

    io = new IoServer(server, {
        cors: {
            origin: '*',
        }
    })

    const connections = io.of('/signal')

    connections.on('connection', async (socket) => {
        socket.emit('connection_success', { socketId: socket.id })

        socket.on('joinRoom', async ({ roomName }, callback) => {
            const room = await createRoom(getWorker(), roomName, socket.id)

            setPeer(socket.id, {
                socket,
                roomName,
                transports: [],
                consumers: [],
                producers: [],
                peerDetails: {/** name, permissions... */}
            })

            callback({
                rtpCapabilities: getRtpCapabilities(room.router)
            })
        })

        socket.on('disconnect', () => {
            removePeer(socket.id)
        })

        socket.on('createWebRtcTransport', async ({ consumer }, callback) => {
            const roomName = getPeer(socket.id).roomName

            try {
                const transport = await createWebRtcTransport(getRoomsRouter(roomName))

                addTransport(roomName, socket.id, transport, consumer)

                callback({
                    params: {
                        id: transport.id,
                        iceParameters: transport.iceParameters,
                        iceCandidates: transport.iceCandidates,
                        dtlsParameters: transport.dtlsParameters
                    }
                })
            } catch (e) {
                callback({
                    params: {
                        error: e.message
                    }
                })
            }
        })

        socket.on('transport-connect', async ({ dtlsParameters }) => {
            await getProducerTransport(socket.id)?.connect({ dtlsParameters })
        })

        socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
            const roomName = getPeer(socket.id).roomName
            const producerTransport = getProducerTransport(socket.id)
            const params = { kind, rtpParameters }
            const producer = await createProducer(roomName, socket.id, producerTransport, params)

            callback({
                id: producer.id,
                producersExist: getAllProducers().length > 1
            })
        })

        socket.on('getProducers', (callback) => {
            const { roomName } = getPeer(socket.id)
            const producers = getProducersInSameRoom(socket.id, roomName) || []

            callback(producers)
        })

        socket.on('transport-receive-connect', async ({ dtlsParameters, serverConsumerTransportId }) => {
            await transportConnect(getConsumerTransport(serverConsumerTransportId).transport, { dtlsParameters })
        })

        socket.on('consume', async (data, callback) => {
            const { rtpCapabilities, remoteProducerId, serverConsumerTransportId } = data
            const { roomName } = getPeer(socket.id)
            const router = getRoom(roomName).router
            const consumerTransport = getConsumerTransport(serverConsumerTransportId).transport

            socket.on('disconnect', () => {
                socket.emit('producer-closed', { remoteProducerId })
            })

            const consumeParams = {
                producerId: remoteProducerId,
                rtpCapabilities,
            }
            try {
                const canConsume = router.canConsume(consumeParams)

                if (canConsume) {
                    const consumer = await createConsumer(roomName, socket.id, consumerTransport, {
                        ...consumeParams,
                        paused: true
                    }, () => {
                        socket.emit('producer-closed', { remoteProducerId })
                    })

                    callback({
                        params: {
                            id: consumer.id,
                            producerId: remoteProducerId,
                            kind: consumer.kind,
                            rtpParameters: consumer.rtpParameters,
                        }
                    })
                }
            } catch(e) {
                console.log(e)
                callback({
                    params: {
                        error: e
                    }
                })
            }
        })

        socket.on('consumer-resume', async ({ serverConsumerId }) => {
            await getConsumerById(serverConsumerId).consumer.resume()
        })

    })



    return getSocketIo()
}
