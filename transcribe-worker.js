// transcribe-worker.js
//
// This file lives in /public because Astro's Vite bundler does NOT process
// anything inside public/ — files there are copied to the output verbatim
// and served as-is. That means a `import { pipeline } from '@xenova/transformers'`
// bare specifier would fail here (no bundler around to resolve node_modules
// for us, and no import map is set up for a raw public/ worker). To keep this
// worker fully self-contained and working in both dev and prod, we import the
// library straight from a CDN as an ESM module. The version is pinned to the
// same major version installed in the project (2.x) to keep API compatibility.
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js';

// Let transformers.js manage its own model cache in the browser (IndexedDB)
// so the ~40-75MB whisper-tiny.en weights are only ever downloaded once.
env.allowLocalModels = false;
env.useBrowserCache = true;

/** @type {Promise<any> | null} */
let transcriberPromise = null;

function getTranscriber() {
	if (!transcriberPromise) {
		transcriberPromise = pipeline(
			'automatic-speech-recognition',
			'Xenova/whisper-tiny.en',
			{
				progress_callback: (progress) => {
					// progress events look like:
					// { status: 'progress', file, loaded, total, progress }
					// { status: 'done', file }
					// { status: 'ready' }
					self.postMessage({ type: 'progress', progress });
				},
			}
		);
	}
	return transcriberPromise;
}

// Normalize a transformers.js chunk list ([{ timestamp: [start, end], text }])
// into plain serializable objects. The final chunk's end timestamp can be null
// (Whisper quirk) — fall back to the known audio duration, then to start + 2s.
function normalizeChunks(chunks, audioDuration) {
	if (!Array.isArray(chunks)) return [];
	return chunks
		.filter((c) => c && typeof c.text === 'string')
		.map((c) => {
			const start = Array.isArray(c.timestamp) && typeof c.timestamp[0] === 'number' ? c.timestamp[0] : 0;
			let end = Array.isArray(c.timestamp) && typeof c.timestamp[1] === 'number' ? c.timestamp[1] : null;
			if (end === null || end <= start) {
				end = typeof audioDuration === 'number' && audioDuration > start ? audioDuration : start + 2;
			}
			return { start, end, text: c.text };
		});
}

self.addEventListener('message', async (event) => {
	const { type, audio, duration } = event.data || {};

	if (type !== 'transcribe') return;

	try {
		self.postMessage({ type: 'status', stage: 'loading-model' });

		const transcriber = await getTranscriber();

		self.postMessage({ type: 'status', stage: 'transcribing' });

		// --- Live partial transcript plumbing (whisper-web pattern) -----------
		// chunk_callback fires when a 30s window is finalised; callback_function
		// fires on every generation step within the current window. We decode
		// the accumulated tokens with the tokenizer's ASR decoder and stream the
		// partial text back to the page, throttled so we don't flood the main
		// thread with one postMessage per generated token.
		const timePrecision =
			transcriber.processor.feature_extractor.config.chunk_length /
			transcriber.model.config.max_source_positions;

		const chunksToProcess = [{ tokens: [], finalised: false }];
		let lastPartialSent = 0;

		function chunkCallback(chunk) {
			const last = chunksToProcess[chunksToProcess.length - 1];
			Object.assign(last, chunk);
			last.finalised = true;
			if (!chunk.is_last) {
				chunksToProcess.push({ tokens: [], finalised: false });
			}
		}

		function callbackFunction(item) {
			const last = chunksToProcess[chunksToProcess.length - 1];
			last.tokens = [...item[0].output_token_ids];

			const now = Date.now();
			if (now - lastPartialSent < 300) return; // throttle
			lastPartialSent = now;

			try {
				const decoded = transcriber.tokenizer._decode_asr(chunksToProcess, {
					time_precision: timePrecision,
					return_timestamps: true,
					force_full_sequences: false,
				});
				self.postMessage({ type: 'partial', text: (decoded && decoded[0]) || '' });
			} catch {
				// Partial decoding is best-effort; never let it kill the real job.
			}
		}

		const output = await transcriber(audio, {
			chunk_length_s: 30,
			stride_length_s: 5,
			return_timestamps: true,
			force_full_sequences: false,
			chunk_callback: chunkCallback,
			callback_function: callbackFunction,
		});

		self.postMessage({
			type: 'result',
			text: (output && output.text ? output.text : '').trim(),
			chunks: normalizeChunks(output && output.chunks, duration),
		});
	} catch (err) {
		self.postMessage({
			type: 'error',
			message: err && err.message ? err.message : String(err),
		});
	}
});
