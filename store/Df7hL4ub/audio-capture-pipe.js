import { AudioMode, AudioSampleFormat } from 'corevm-host'
import { float_to_s16, float_to_s32 } from '../audio-transcoding.js'
import { ConverterType, create } from '@alexanderolsen/libsamplerate-js'

/**
An implementation of AudioWorkletProcessor that transcodes the input and sends it via the port to the builder.
*/
class AudioCapturePipe extends AudioWorkletProcessor {
    #mode
    #port
    #gain = 1
    #resampler = null

    constructor(...args) {
        super(...args)
        this.port.onmessage = (e) => {
            switch (e.data.type) {
                case 'init':
                    this.#mode = AudioMode.fromPlain(e.data.mode)
                    this.#port = e.ports[0]
                    this.#port.start()
                    this.#gain = e.data.gain
                    if (e.data.sourceSampleRate !== e.data.mode.sampleRate) {
                        console.debug(
                            `Resampling from ${e.data.sourceSampleRate} Hz to ${e.data.mode.sampleRate} Hz`,
                        )
                        // Always one channel because we resample one channel at a time.
                        const numChannels = 1
                        create(numChannels, e.data.sourceSampleRate, e.data.mode.sampleRate, {
                            converterType: ConverterType.SRC_SINC_BEST_QUALITY,
                        }).then((resampler) => {
                            this.#resampler = resampler
                        })
                    }
                    break
                case 'gain':
                    this.#gain = e.data.gain
                    break
                default:
                    console.error(`Invalid message type ${e.data.type}`)
                    break
            }
        }
    }

    // TODO @ivan Handle input channels > output channels (mixing).
    process(inputs, _outputs, _parameters) {
        if (!this.#mode) {
            return
        }
        const input =
            this.#resampler === null
                ? inputs[0]
                : inputs[0].map((channel) => this.#resampler.full(channel))
        const numInputChannels = input.length
        if (numInputChannels === 0) {
            return
        }
        const numSamplesPerChannel = input[0].length
        const outputFrameLen = this.#mode.frameLen()
        const buf = new ArrayBuffer(numSamplesPerChannel * outputFrameLen + 1)
        {
            const bytes = new Uint8Array(buf)
            bytes[0] = 0 // audio input discriminator
        }
        const view = new DataView(buf, 1)
        const numCommonChannels = Math.min(numInputChannels, this.#mode.channels)
        const outputSampleLen = this.#mode.sampleLen()
        for (let ch = 0; ch < numCommonChannels; ++ch) {
            const channel = input[ch]
            // Apply gain.
            for (let i = 0; i < channel.length; ++i) {
                channel[i] *= this.#gain
            }
            const offset = outputSampleLen * ch
            switch (this.#mode.sampleFormat) {
                case AudioSampleFormat.S16LE:
                    float_to_s16(channel, view, offset, outputFrameLen, true)
                    break
                case AudioSampleFormat.S32LE:
                    float_to_s32(channel, view, offset, outputFrameLen, true)
                    break
            }
        }
        this.#port.postMessage(buf, [buf])
        return true
    }
}

registerProcessor('audio-capture-pipe', AudioCapturePipe)
