<template>
	<view class="page">
		<view class="header">
			<text class="title">音频翻译</text>
			<text class="subtitle">高精度 ASR · MT · TTS 试听</text>
		</view>

		<view class="card">
			<text class="label">选择本地音频</text>
			<text class="hint req">· 百度「音频文件转写」：先上传 BOS 再识别，支持数分钟音频</text>
			<text class="hint req">· 格式 WAV/MP3/M4A，≤500MB；需在 .env 配置 BOS</text>
			<text class="hint req">· 未配置 BOS 时回退短语音（≤60秒）</text>
			<button type="primary" @click="chooseAudio">选择文件</button>
			<text class="hint">{{ audioName || '未选择文件' }}</text>
		</view>

		<view class="card row">
			<picker :range="langLabels" :value="sourceIndex" @change="onSourceChange">
				<view class="picker">源语言: {{ langLabels[sourceIndex] }}</view>
			</picker>
			<picker :range="langLabels" :value="targetIndex" @change="onTargetChange">
				<view class="picker">目标: {{ langLabels[targetIndex] }}</view>
			</picker>
		</view>

		<view class="card">
			<text class="label">合成发音人</text>
			<picker :range="voiceLabels" :value="voiceIndex" @change="onVoiceChange">
				<view class="picker">{{ voiceLabels[voiceIndex] }}</view>
			</picker>
		</view>

		<button type="primary" :loading="loading" :disabled="!audioPath && !audioFile" @click="process">
			开始处理
		</button>

		<view class="card">
			<text class="label">识别原文（可修正）</text>
			<textarea
				class="textarea"
				v-model="originalText"
				:disabled="loading"
				placeholder="识别结果，不准确可手动修改"
				auto-height
			/>
			<text v-if="asrMetaText" class="hint">{{ asrMetaText }}</text>
			<button type="default" size="mini" :disabled="loading || !canRetranslate" @click="retranslate">
				用修正原文重新翻译并合成
			</button>
		</view>

		<view class="card">
			<text class="label">译文</text>
			<text class="result">{{ translatedText }}</text>
		</view>

		<view class="card" v-if="ttsAudioUrl">
			<text class="label">合成语音试听</text>
			<text v-if="ttsMetaText" class="hint">{{ ttsMetaText }}</text>
			<text class="hint">点击下方按钮播放合成 MP3</text>
			<button type="primary" size="mini" @click="playTts">播放</button>
			<button type="default" size="mini" @click="pauseTts">暂停</button>
		</view>

		<view class="card">
			<text class="label">运行日志</text>
			<text class="log">{{ runLog }}</text>
		</view>
	</view>
</template>

<script>
	const API_BASE = 'http://localhost:3000'
	const LANG_CODES = ['zh', 'en', 'jp', 'kor']
	const LANG_LABELS = ['中文', '英语', '日语', '韩语']
	const VOICE_IDS = [5118, 4194, 4193, 5003, 4105, 4149, 4, 0]
	const VOICE_LABELS = [
		'度小鹿（精品女声）',
		'度嫣然（大模型女声）',
		'度泽言（大模型男声）',
		'度逍遥（精品男声）',
		'度灵儿（臻品·英语）',
		'度星河（臻品男声）',
		'度丫丫（基础女声）',
		'度小美（基础女声）'
	]

	export default {
		data() {
			return {
				apiBase: API_BASE,
				audioPath: '',
				audioFile: null,
				audioName: '',
				langLabels: LANG_LABELS,
				sourceIndex: 0,
				targetIndex: 1,
				voiceLabels: VOICE_LABELS,
				voiceIndex: 0,
				loading: false,
				originalText: '',
				translatedText: '—',
				asrMetaText: '',
				ttsAudioUrl: '',
				ttsMetaText: '',
				runLog: '',
				innerAudio: null
			}
		},
		computed: {
			canRetranslate() {
				return this.originalText && this.originalText.trim() && this.originalText !== '处理中…'
			}
		},
		onUnload() {
			if (this.innerAudio) {
				this.innerAudio.destroy()
			}
		},
		methods: {
			log(line) {
				const t = new Date().toLocaleTimeString()
				this.runLog += `[${t}] ${line}\n`
			},
			onSourceChange(e) {
				this.sourceIndex = Number(e.detail.value)
			},
			onTargetChange(e) {
				this.targetIndex = Number(e.detail.value)
				if (LANG_CODES[this.targetIndex] === 'en' && this.voiceIndex === 0) {
					this.voiceIndex = 4
				}
			},
			onVoiceChange(e) {
				this.voiceIndex = Number(e.detail.value)
			},
			getTtsPer() {
				return String(VOICE_IDS[this.voiceIndex])
			},
			setSelectedFile(file, path, name) {
				if (this.audioPath && this.audioPath.startsWith('blob:')) {
					URL.revokeObjectURL(this.audioPath)
				}
				this.audioFile = file || null
				this.audioPath = path
				this.audioName = name
				this.log(`已选择: ${name}`)
			},
			chooseAudio() {
				if (typeof uni.chooseMessageFile === 'function') {
					uni.chooseMessageFile({
						count: 1,
						type: 'file',
						extension: ['.wav', '.mp3', '.m4a'],
						success: (res) => {
							const f = res.tempFiles[0]
							this.setSelectedFile(null, f.path, f.name)
						},
						fail: (err) => {
							uni.showToast({ title: err.errMsg || '选择失败', icon: 'none' })
						}
					})
					return
				}

				if (typeof uni.chooseFile === 'function') {
					uni.chooseFile({
						count: 1,
						extension: ['.wav', '.mp3', '.m4a'],
						success: (res) => {
							const f = res.tempFiles[0]
							this.setSelectedFile(null, f.path, f.name)
						},
						fail: (err) => {
							uni.showToast({ title: err.errMsg || '选择失败', icon: 'none' })
						}
					})
					return
				}

				this.pickFileH5()
			},
			pickFileH5() {
				if (typeof document === 'undefined') {
					uni.showToast({ title: '当前环境不支持选择文件', icon: 'none' })
					return
				}
				const input = document.createElement('input')
				input.type = 'file'
				input.accept = '.wav,.mp3,.m4a,.aac,audio/*'
				input.onchange = (e) => {
					const file = e.target.files && e.target.files[0]
					if (!file) return
					const ext = file.name.split('.').pop()?.toLowerCase()
					if (!['wav', 'mp3', 'm4a', 'aac', 'mp4'].includes(ext)) {
						uni.showToast({ title: '仅支持 WAV / MP3 / M4A', icon: 'none' })
						return
					}
					this.setSelectedFile(file, URL.createObjectURL(file), file.name)
				}
				input.click()
			},
			applyResult(data) {
				this.originalText = data.originalText || ''
				this.translatedText = data.translatedText || '—'
				if (data.asrMeta) {
					this.asrMetaText = `模型 dev_pid=${data.asrMeta.devPid}，约 ${data.asrMeta.durationSec}s，${data.asrMeta.segments} 段`
				}
				if (data.ttsMeta?.per !== undefined) {
					this.ttsMetaText = `发音人 per=${data.ttsMeta.per}`
					const idx = VOICE_IDS.indexOf(data.ttsMeta.per)
					if (idx >= 0) this.voiceIndex = idx
				}
				if (data.timings) {
					const t = data.timings
					const parts = []
					if (t.bos != null) parts.push(`BOS${t.bos}ms`)
					if (t.asrPoll != null) parts.push(`轮询${t.asrPoll}ms`)
					if (t.asr != null) parts.push(`ASR${t.asr}ms`)
					if (t.mt != null) parts.push(`MT${t.mt}ms`)
					if (t.tts != null) parts.push(`TTS${t.tts}ms`)
					if (t.total != null) parts.push(`总计${t.total}ms`)
					this.log(`耗时 ${parts.join(' ')}`)
				}
				if (data.files?.ttsAudio) {
					this.ttsAudioUrl = `${this.apiBase}${data.files.ttsAudio}`
					this.setupInnerAudio(this.ttsAudioUrl)
				}
				this.log('完成，可试听合成语音')
			},
			setupInnerAudio(url) {
				if (!this.innerAudio) {
					this.innerAudio = uni.createInnerAudioContext()
				}
				this.innerAudio.src = url
			},
			playTts() {
				if (!this.innerAudio && this.ttsAudioUrl) {
					this.setupInnerAudio(this.ttsAudioUrl)
				}
				this.innerAudio?.play()
			},
			pauseTts() {
				this.innerAudio?.pause()
			},
			handleProcessResult(data) {
				if (data.success) {
					this.applyResult(data)
				} else {
					this.log(data.message || '失败')
					uni.showToast({ title: data.message || '失败', icon: 'none' })
				}
			},
			retranslate() {
				const text = this.originalText.trim()
				if (!text) return
				this.loading = true
				this.log('重新翻译…')
				fetch(`${this.apiBase}/api/reprocess`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						originalText: text,
						sourceLang: LANG_CODES[this.sourceIndex],
						targetLang: LANG_CODES[this.targetIndex],
						ttsPer: this.getTtsPer()
					})
				})
					.then(async (res) => {
						const data = await res.json()
						if (!res.ok) throw new Error(data.message || '失败')
						return data
					})
					.then((data) => this.handleProcessResult(data))
					.catch((err) => {
						this.log(err.message)
						uni.showToast({ title: err.message, icon: 'none' })
					})
					.finally(() => {
						this.loading = false
					})
			},
			process() {
				if (!this.audioPath && !this.audioFile) return
				this.loading = true
				this.originalText = '处理中…'
				this.translatedText = '处理中…'
				this.ttsAudioUrl = ''
				this.log('上传处理中…')

				const form = {
					sourceLang: LANG_CODES[this.sourceIndex],
					targetLang: LANG_CODES[this.targetIndex],
					ttsPer: this.getTtsPer()
				}

				if (this.audioFile) {
					const body = new FormData()
					body.append('audio', this.audioFile, this.audioName)
					body.append('sourceLang', form.sourceLang)
					body.append('targetLang', form.targetLang)
					body.append('ttsPer', this.getTtsPer())
					fetch(`${this.apiBase}/api/process`, { method: 'POST', body })
						.then(async (res) => {
							const data = await res.json()
							if (!res.ok) {
								throw new Error(data.message || `请求失败 ${res.status}`)
							}
							return data
						})
						.then((data) => this.handleProcessResult(data))
						.catch((err) => {
							this.log(err.message || '网络错误')
							uni.showToast({
								title: err.message || '请确认 Node 后端已启动',
								icon: 'none',
								duration: 3000
							})
						})
						.finally(() => {
							this.loading = false
						})
					return
				}

				uni.uploadFile({
					url: `${this.apiBase}/api/process`,
					filePath: this.audioPath,
					name: 'audio',
					formData: form,
					success: (res) => {
						let data = {}
						try {
							data = JSON.parse(res.data)
						} catch {
							this.log('响应解析失败')
							return
						}
						this.handleProcessResult(data)
					},
					fail: (err) => {
						this.log(err.errMsg || '网络错误')
						uni.showToast({ title: '请确认 Node 后端已启动', icon: 'none' })
					},
					complete: () => {
						this.loading = false
					}
				})
			}
		}
	}
</script>

<style>
	.page {
		padding: 24rpx;
	}
	.header {
		margin-bottom: 32rpx;
	}
	.title {
		font-size: 40rpx;
		font-weight: 600;
		display: block;
	}
	.subtitle {
		font-size: 26rpx;
		color: #64748b;
		margin-top: 8rpx;
		display: block;
	}
	.card {
		background: #fff;
		border-radius: 16rpx;
		padding: 24rpx;
		margin-bottom: 24rpx;
	}
	.row {
		display: flex;
		justify-content: space-between;
	}
	.hint {
		display: block;
		margin-top: 16rpx;
		font-size: 26rpx;
		color: #64748b;
	}
	.hint.req {
		margin-top: 8rpx;
		font-size: 24rpx;
		line-height: 1.5;
	}
	.label {
		font-weight: 600;
		display: block;
		margin-bottom: 12rpx;
	}
	.textarea {
		width: 100%;
		min-height: 160rpx;
		padding: 16rpx;
		font-size: 28rpx;
		line-height: 1.6;
		border: 1rpx solid #e2e8f0;
		border-radius: 12rpx;
		box-sizing: border-box;
	}
	.result, .log {
		font-size: 28rpx;
		line-height: 1.6;
		white-space: pre-wrap;
	}
	.log {
		color: #475569;
		font-size: 24rpx;
	}
	.picker {
		padding: 16rpx 0;
	}
</style>
