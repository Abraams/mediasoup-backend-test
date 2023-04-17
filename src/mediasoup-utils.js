import mediasoup from "mediasoup";

let worker = null
let rooms = {}
let peers = {}
let transports = []
let producers = []
let consumers = []

const mediaCodecs = [
    {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2
    },
    {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
            'x-google-start-bitrate': 1000
        }
    }
]

export const createWorker = async () => {
    worker = await mediasoup.createWorker({
        rtcMinPort: 10000,
        rtcMaxPort: 10100
    })
    worker.on('died', (error) => {
        console.error('worker has died')
        setTimeout(() => process.exit(1), 2000)
    })

    return worker
}

export const createRouter = (worker) => {
    return worker.createRouter({ mediaCodecs })
}

export const getRoom = (roomName) => rooms[roomName]
export const setRoom = (roomName, room) => rooms[roomName] = room

export const getPeer = (id) => peers[id]
export const setPeer = (id, peer) => {
    peers[id] = {
        ...(peers[id] || {}),
        ...peer
    }
}

export const removePeer = (peerId) => {
    consumers = removeItems(consumers, peerId, 'consumer')
    transports = removeItems(transports, peerId, 'transports')
    producers = removeItems(producers, peerId, 'producers')

    const { roomName } = getPeer(peerId) || {}
    const room = getRoom(roomName)

    console.log(room)

    setRoom(roomName, {
        router: room?.router,
        peers: room?.peers.filter(peerId => peerId !== peerId)
    })

    delete peers[peerId]
}

export const createRoom = async (worker, roomName, peerId) => {
    let router = null
    let peers = []

    if (getRoom(roomName)) {
        router = getRoom(roomName).router
        peers = getRoom(roomName).peers || []
    } else {
        router = await createRouter(worker)
    }

    setRoom(roomName, {
        router,
        peers: [...peers, peerId]
    })

    return getRoom(roomName)
}

export const createWebRtcTransport = async (router) => {
    try {
        const webRtcTransportOptions = {
            listenIps: [
                {
                    ip: '127.0.0.1',
                }
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true
        }

        let transport = await router.createWebRtcTransport(webRtcTransportOptions)
        transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'closed') {
                transport.close()
            }
        })

        return transport

    } catch (e) {
        throw new Error(e.message)
    }
}

export const transportConnect = (transport, params) => {
    transport.connect(params)
}

export const addProducer = (producer, roomName, peerId) => {
    producers = [
        ...producers,
        {
            peerId,
            producer,
            roomName
        }
    ]

    const peer = (getPeer(peerId) || {})
    setPeer(peerId, {
        ...peer,
        producers: [
            ...(peer.producers || []),
            producer.id
        ]
    })
}

export const informConsumers = (roomName, peerId, producerId) => {
    producers.forEach(producerData => {
        if (producerData.peerId !== peerId && producerData.roomName === roomName) {
            const producerSocket = getPeer(producerData.peerId).socket
            producerSocket.emit('new-producer', producerId)
        }
    })
}

export const createProducer = async (roomName, peerId, transport, params) => {
    if (!transport) {
        console.error('transport doesn\'t exist')
        return
    }

    const producer = await transport.produce(params)

    producer.on('transportclose', () => {
        producer.close()
    })

    addProducer(producer, roomName, peerId)

    informConsumers(roomName, peerId, producer.id)

    return transport
}
export const createConsumer = async (roomName, peerId, transport, params, onProducerClosed) => {
    const consumer = await transport.consume(params)

    consumer.on('transportclose', () => {
    })

    consumer.on('producerclose', () => {
        onProducerClosed()
        removeTransport(transport.id)
        removeConsumer(consumer.id)
    })

    addConsumer(peerId, roomName, consumer )

    return consumer
}

export const addConsumer = (peerId, roomName, consumer) => {
    consumers = [
        ...consumers,
        {
            peerId,
            consumer,
            roomName
        }
    ]

    const peer = (getPeer(peerId) || {})
    setPeer(peerId, {
        ...peer,
        consumers: [
            ...(peer.consumers || []),
            consumer.id
        ]
    })
}

export const getRtpCapabilities = (router) => router.rtpCapabilities

export const getWorker = () => worker
export const getRoomsRouter = (roomName) => getRoom(roomName).router

export const getProducerTransport = (peerId) => {
    return transports.find(transport => transport.peerId === peerId && !transport.consumer)?.transport
}

export const getConsumerTransport = (id) => {
    return transports.find(transportData => transportData.consumer && transportData.transport.id === id)
}

export const removeConsumer = (id) => {
    const consumer = consumers.find(consumerData => consumerData.consumer.id === id)
    consumer.close()
    consumers = consumers.filter(consumerData => consumerData.consumer.id !== id)
}

export const addTransport = (roomName, peerId, transport, consumer) => {
    transports.push({
        peerId,
        transport,
        roomName,
        consumer
    })

    const peer = getPeer(peerId) || {}

    setPeer(peerId, {
        ...peer,
        transports: [
            ...(peer.transports || []),
            transport
        ]
    })
}

export const removeTransport = (id) => {
    const transport = transports.find(transportData => transportData.transport.id === id)
    transport.close()
    transports = transports.filter(transportData => transportData.transport.id !== id)
}

export const getAllProducers = () => producers

export const getProducersInSameRoom = (peerId, roomName) => {
    let list = []

    producers.forEach(producerData => {
        if (producerData.peerId !== peerId && producerData.roomName === roomName) {
            list.push(producerData.producer.id)
        }
    })

    return list
}

export const getConsumerById = (id) => {
    return consumers.find(consumerData => consumerData.consumer.id === id)
}

const removeItems = (arr, peerId, type) => {
    arr.forEach(item => {
        if (item.peerId === peerId) {
            item[type]?.close()
        }
    })

    return arr.filter(item => item.peerId !== peerId)
}

