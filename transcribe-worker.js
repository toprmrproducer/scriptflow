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

self.addEventListener('message', async (event) => {
	const { type, audio } = event.data || {};

	if (type !== 'transcribe') return;

	try {
		self.postMessage({ type: 'status', stage: 'loading-model' });

		const transcriber = await getTranscriber();

		self.postMessage({ type: 'status', stage: 'transcribing' });

		const output = await transcriber(audio, {
			chunk_length_s: 30,
			stride_length_s: 5,
		});

		self.postMessage({
			type: 'result',
			text: (output && output.text ? output.text : '').trim(),
		});
	} catch (err) {
		self.postMessage({
			type: 'error',
			message: err && err.message ? err.message : String(err),
		});
	}
});
