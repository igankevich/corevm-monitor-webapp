/**
An implementation of AudioWorkletProcessor that sends the data received via its port to the audio device.

@module workers/audio-pipe
*/
class AudioPipe extends AudioWorkletProcessor {
    #chunks = []
    // Offset within the current chunk (in samples).
    #offset = 0
    // How many frames were consumed by AudioContext by the time of the last call to `process`.
    #framesPlayed = 0
    // How many frames will be consumed by AudioContext by the time of the next call to `process`.
    #nextFramesPlayed = 0
    // Last time AudioContext consumed frames.
    //
    // We use Date here because `performance` is not defined in AudioWorklet: https://github.com/w3c/hr-time/pull/169
    #lastCallbackTime = Date.now()

    constructor(...args) {
        super(...args)
        this.port.onmessage = (e) => {
            switch (e.data.type) {
                case 'chunk':
                    this.#chunks.push(e.data.channels.map((buffer) => new Float32Array(buffer)))
                    break
                case 'first-chunk': {
                    this.#offset = e.data.offset
                    this.#framesPlayed = e.data.framesPlayed
                    this.#nextFramesPlayed = e.data.framesPlayed
                    this.#lastCallbackTime = Date.now()
                    this.#chunks.push(e.data.channels.map((buffer) => new Float32Array(buffer)))
                    break
                }
                case 'reset':
                    this.#chunks = []
                    this.#offset = 0
                    this.#framesPlayed = 0
                    this.#nextFramesPlayed = 0
                    this.#lastCallbackTime = Date.now()
                    break
                default:
                    throw new Error(`Invalid message type: ${e.data.type}`)
            }
        }
    }

    process(inputs, outputs, _parameters) {
        this.#lastCallbackTime = Date.now()
        this.#framesPlayed = this.#nextFramesPlayed
        const output = outputs[0]
        let dstOffset = 0
        while (this.#chunks.length !== 0 && dstOffset !== output[0].length) {
            let chunk = this.#chunks[0]
            // Should be the same for every channel.
            let n = 0
            for (let ch = 0; ch < output.length; ++ch) {
                const dst = output[ch]
                const src = chunk[ch]
                n = Math.min(src.length - this.#offset, dst.length - dstOffset)
                dst.set(src.subarray(this.#offset, this.#offset + n), dstOffset)
            }
            this.#offset += n
            dstOffset += n
            if (this.#offset === chunk[0].length) {
                this.#chunks.shift()
                this.#offset = 0
            }
        }
        // Each sample is float32 here.
        this.#nextFramesPlayed += dstOffset
        // Report status to help engine synchronize video and audio.
        this.port.postMessage({
            type: 'status',
            framesPlayed: this.#framesPlayed,
            nextFramesPlayed: this.#nextFramesPlayed,
            lastCallbackTime: this.#lastCallbackTime,
        })
        return true
    }
}

registerProcessor('audio-pipe', AudioPipe)
