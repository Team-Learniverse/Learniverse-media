import config from "./config.js";

class Room {
  constructor(coreTimeId, worker, io) {
    this.id = coreTimeId;
    const mediaCodecs = config.mediasoup.router.mediaCodecs;
    worker
      .createRouter({
        mediaCodecs,
      })
      .then(
        function (router) {
          this.router = router;
        }.bind(this)
      );

    this.peers = new Map();
    this.io = io;
  }

  addPeer(peer) {
    this.peers.set(peer.id, peer);
  }

  getProducerListForPeer() {
    let producerList = [];
    this.peers.forEach((peer) => {
      peer.producers.forEach((producer) => {
        const producerInfo = peer.produceTypes.get(producer.id);
        producerList.push({
          producer_id: producer.id,
          producer_type: producerInfo.type,
          socketId: producerInfo.id,
          memberId: producerInfo.name,
        });
      });
    });
    return producerList;
  }

  getRtpCapabilities() {
    return this.router.rtpCapabilities;
  }

  async createWebRtcTransport(socket_id) {
    const { maxIncomingBitrate, initialAvailableOutgoingBitrate } =
      config.mediasoup.webRtcTransport;

    const transport = await this.router.createWebRtcTransport({
      listenIps: config.mediasoup.webRtcTransport.listenIps,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate,
    });
    if (maxIncomingBitrate) {
      try {
        await transport.setMaxIncomingBitrate(maxIncomingBitrate);
      } catch (error) {}
    }

    transport.on(
      "dtlsstatechange",
      function (dtlsState) {
        if (dtlsState === "closed") {
          console.log("Transport close", {
            name: this.peers.get(socket_id).name,
          });
          transport.close();
        }
      }.bind(this)
    );

    transport.on("close", () => {
      console.log("Transport close", { name: this.peers.get(socket_id).name });
    });

    console.log("Adding transport", { transportId: transport.id });
    this.peers.get(socket_id).addTransport(transport);
    return {
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    };
  }

  async connectPeerTransport(socket_id, transport_id, dtlsParameters) {
    if (!this.peers.has(socket_id)) return;

    await this.peers
      .get(socket_id)
      .connectTransport(transport_id, dtlsParameters);
  }

  async produce(
    socket_id,
    socket_name,
    producerTransportId,
    rtpParameters,
    kind
  ) {
    // handle undefined errors
    return new Promise(
      async function (resolve, reject) {
        let producer = await this.peers
          .get(socket_id)
          .createProducer(
            socket_id,
            socket_name,
            producerTransportId,
            rtpParameters,
            kind
          );
        resolve(producer.id);
        this.broadCast(socket_id, "newProducers", [
          {
            producer_id: producer.id,
            producer_type: kind,
            socketId: socket_id,
            memberId: socket_name,
          },
        ]);
      }.bind(this)
    );
  }

  async consume(
    socket_id,
    consumer_transport_id,
    producer_id,
    producer_name,
    rtpCapabilities
  ) {
    // handle nulls
    if (
      !this.router.canConsume({
        producerId: producer_id,
        rtpCapabilities,
      })
    ) {
      console.error("can not consume");
      return;
    }

    let { consumer, params } = await this.peers
      .get(socket_id)
      .createConsumer(
        consumer_transport_id,
        producer_id,
        producer_name,
        rtpCapabilities
      );

    consumer.on(
      "producerclose",
      function () {
        console.log("Consumer closed due to producerclose event", {
          name: `${this.peers.get(socket_id).name}`,
          consumer_id: `${consumer.id}`,
        });
        this.peers.get(socket_id).removeConsumer(consumer.id);
        // tell client consumer is dead
        this.io.to(socket_id).emit("consumerClosed", {
          consumer_id: consumer.id,
        });
      }.bind(this)
    );

    return params;
  }

  async removePeer(socket_id) {
    this.peers.get(socket_id).close();
    this.peers.delete(socket_id);
  }

  closeProducer(socket_id, producer_id) {
    this.peers.get(socket_id).closeProducer(producer_id);
  }

  broadCast(socket_id, name, data) {
    for (let otherID of Array.from(this.peers.keys()).filter(
      (id) => id !== socket_id
    )) {
      this.send(otherID, name, data);
    }
  }

  send(socket_id, name, data) {
    this.io.to(socket_id).emit(name, data);
  }

  getPeers() {
    return this.peers;
  }

  toJson() {
    return {
      id: this.id,
      peers: JSON.stringify([...this.peers]),
    };
  }
}

export default Room;
