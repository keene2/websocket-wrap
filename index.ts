class WebSocketClient {
  constructor(url) {
    this.url = url
    this.socket = null
    this.isOpened = false
    this.messageQueue = []
    this.reconnectTimer = null
    this.idCounter = 1
    this.reconnectCount = 0
    this.subscriptions = new Map()
    this.usingRestfulAPI = false
    this.isBehind = false // 是否后台关闭 ws 连接状态
    this.idleTime = 10 * 60 * 1000
    this.initWebSocket()
  }
  initWebSocket() {
    this.socket = new WebSocket(this.url)
    this.socket.onopen = () => {
      console.log('WebSocket connection onopen')
      this.lastActiveTime = Date.now()
      this.isOpened = true
      this.isBehind = false
      this.usingRestfulAPI = false
      this.reconnectCount = 0
      this.sendCachedMessages()
      this.stopReconnect()
      this.checkIdleTimer = setInterval(() => {
        this.checkIdleTime()
      }, 60000)
    }
    this.socket.onmessage = (event) => this.onMessage(event)
    this.socket.onclose = (event) => {
      this.isOpened = false
      if (!this.isBehind) this.reconnect()
      console.log(
        'WebSocket connection closed with code ' +
          event.code +
          ', reason: ' +
          event.reason +
          ', wasClean: ' +
          event.wasClean,
      )
      clearInterval(this.checkIdleTimer)
    }
    this.socket.onerror = (event) => {
      console.log('WebSocket connection error', event)
      this.isOpened = false
    }
  }
  send(message) {
    this.socket.send(JSON.stringify(message))
  }
  reconnect() {
    console.log('WebSocket reconnecting...')
    clearInterval(this.reconnectTimer)
    const self = this
    this.isOpened = false
    this.reconnectTimer = setTimeout(() => {
      if (self.reconnectCount >= 2) {
        console.error('WebSocket connection failed after multiple attempts.')
        self.stopReconnect()
        self.usingRestfulAPI = true
        self.pollRestfulAPI()
        return
      }
      self.reconnectCount++
      self.initWebSocket()
    }, 1000)
  }
  /**
   * @param params 发送 websocket 参数
   * @param callback 回调函数
   * @param predicate 过滤非不相关的 message 数据，避免重复触发页面的 callback
   */
  subscribe(params, callback, predicate, restfulApiFunc) {
    const id = this.idCounter++
    const message = { ...params, id }
    this.subscriptions.set(id, { message, callback, predicate, restfulApiFunc })
    if (this.usingRestfulAPI) {
      this.pollRestfulAPI(id)
    } else if (!this.isOpened) {
      this.messageQueue.push(message)
    } else {
      this.send(message)
    }
    return id
  }
  async onMessage(event: MessageEvent) {
    const data = JSON.parse(event.data)
    try {
      this.subscriptions.forEach(({ callback, predicate }) => {
        if (data?.error !== undefined) {
          callback(data.error, null)
        } else if (predicate(data)) {
          callback(null, data)
        }
      })
    } catch (error) {
      console.log('WebSocket connection onMessage error: ', error)
    }
  }

  checkIdleTime() {
    console.log('WebSocket connection checkIdleTime...')
    console.log('WebSocket connection subscriptions', Array.from(this.subscriptions.values()))
    const now = Date.now()
    if (now - this.lastActiveTime > this.idleTime && this.isOpened) {
      console.log(`WebSocket connection exceeds ${this.idleTime} ms, closing...`)
      // 缓存 subscriptions 中的任务到 messageQueue
      this.messageQueue = Array.from(this.subscriptions.values()).map((item) => item.message)
      console.log('WebSocket connection: 缓存的任务', this.messageQueue)
      this.isBehind = true
      this.close()
    }
  }
  handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      console.log('WebSocket connection hidden')
      this.checkIdleTime()
    } else {
      console.log('WebSocket connection visible')
      this.lastActiveTime = Date.now() // 更新最后活动时间
      if (!this.isOpened) {
        this.reconnect()
      }
    }
  }

  pollRestfulAPI(id) {
    if (id) {
      this.pollRestfulAPIForSubscription(id)
    } else {
      this.subscriptions.forEach((_, subscriptionId) => {
        this.pollRestfulAPIForSubscription(subscriptionId)
      })
    }
  }

  async pollRestfulAPIForSubscription(id) {
    const subscription = this.subscriptions.get(id)
    const { restfulApiFunc, callback, predicate } = subscription
    if (!restfulApiFunc) return
    if (!subscription.hasOwnProperty('shouldStop')) {
      subscription.shouldStop = false
    }
    while (this.usingRestfulAPI && !subscription.shouldStop) {
      try {
        const response = await restfulApiFunc()
        if (predicate(response)) {
          callback(null, response)
        }
      } catch (error) {
        callback(error, null)
      }
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  stopPollingById(id) {
    const subscription = this.subscriptions.get(id)
    if (subscription) {
      subscription.shouldStop = true
    }
  }

  stopReconnect() {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.reconnectCount = 0
  }

  unsubscribe(id, params) {
    this.stopPollingById(id)
    this.subscriptions.delete(id)
    if (this.isOpened) {
      this.send({ ...params, id: this.idCounter++ })
    }
  }
  sendCachedMessages() {
    if (this.isOpened) {
      while (this.messageQueue.length > 0) {
        this.send(this.messageQueue.shift())
      }
    }
  }
  close() {
    this.socket.close()
  }
}

const webSocketClient = new WebSocketClient(BINANCEURL_WS)


// restfulApiFunc 降级轮询的方法
const = subscribeTickerBatch = (params, callback, restfulApiFunc) => {
  const id = webSocketClient.subscribe(
    { method: 'SUBSCRIBE', params },
    callback,
    (msg) => msg?.stream?.includes('@ticker'),
    restfulApiFunc,
  )
  return () => {
    webSocketClient.unsubscribe(id, { method: 'UNSUBSCRIBE', params })
  }
},

document.addEventListener('visibilitychange', () => {
  webSocketClient.handleVisibilityChange()
})
