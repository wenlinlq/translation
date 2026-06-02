<template>
	<view class="page">
		<view class="header">
			<text class="title">音频翻译</text>
			<text class="subtitle">ASR → MT → TTS（Node 后端）</text>
		</view>

		<view class="card">
			<button type="primary" @click="chooseAudio">选择本地音频 (WAV/MP3)</button>
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

		<button type="primary" :loading="loading" :disabled="!audioPath && !audioFile" @click="process">
			开始处理
		</button>

		<view class="card">
			<text class="label">识别原文</text>
			<text class="result">{{ originalText }}</text>
		</view>
		<view class="card">
			<text class="label">译文</text>
			<text class="result">{{ translatedText }}</text>
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
				loading: false,
				originalText: '—',
				translatedText: '—',
				runLog: ''
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
						extension: ['.wav', '.mp3'],
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
						extension: ['.wav', '.mp3'],
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
				input.accept = '.wav,.mp3,audio/wav,audio/mpeg'
				input.onchange = (e) => {
					const file = e.target.files && e.target.files[0]
					if (!file) return
					const ext = file.name.split('.').pop()?.toLowerCase()
					if (!['wav', 'mp3'].includes(ext)) {
						uni.showToast({ title: '仅支持 WAV / MP3', icon: 'none' })
						return
					}
					this.setSelectedFile(file, URL.createObjectURL(file), file.name)
				}
				input.click()
			},
			handleProcessResult(data) {
				if (data.success) {
					this.originalText = data.originalText
					this.translatedText = data.translatedText
					this.log('完成，文件已保存到 backend/output')
					uni.showModal({
						title: '输出文件',
						content: `文本: ${data.files?.resultTxt}\n音频: ${data.files?.ttsAudio}`,
						showCancel: false
					})
				} else {
					this.log(data.message || '失败')
					uni.showToast({ title: data.message || '失败', icon: 'none' })
				}
			},
			process() {
				if (!this.audioPath && !this.audioFile) return
				this.loading = true
				this.originalText = '处理中…'
				this.translatedText = '处理中…'
				this.log('上传处理中…')

				const form = {
					sourceLang: LANG_CODES[this.sourceIndex],
					targetLang: LANG_CODES[this.targetIndex]
				}

				if (this.audioFile) {
					const body = new FormData()
					body.append('audio', this.audioFile, this.audioName)
					body.append('sourceLang', form.sourceLang)
					body.append('targetLang', form.targetLang)
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
	.label {
		font-weight: 600;
		display: block;
		margin-bottom: 12rpx;
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
