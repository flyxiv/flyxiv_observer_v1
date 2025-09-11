// Use the browser/Electron-renderer ONNX Runtime backends
import * as ort from 'onnxruntime-web';
// Register GPU backends (side-effect imports)
import 'onnxruntime-web/webgpu';


let isPulling = false;
let inferBusy = false;

const MODEL_W = 384;
const MODEL_H = 384;
const START_THRESH = 0.7;
const END_THRESH = 0.7;
const FALLBACK_INPUT_NAME = 'input';

// If you place ORT wasm files under a public path (optional), you can hint the loader:
// Point ORT to fetch its WASM binaries. For offline, copy dist/*.wasm to `public/ort-wasm/` and set '/ort-wasm/'.
// CDN option avoids bundler 404s in dev.
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
// Ensure the model is reachable by the renderer (put it in `public/`)
const MODEL_URL = '/ffxiv_pull_detector.onnx';

type EP = NonNullable<ort.InferenceSession.SessionOptions['executionProviders']>[number];
const pickEPs = () => {
  const eps: EP[] = [];
  // Prefer WebGPU when available (GPU). Requires Chromium with WebGPU enabled (Electron 28+).
  if (typeof navigator !== 'undefined' && (navigator as any).gpu) eps.push('webgpu' as unknown as EP);
  // Always include CPU WASM fallback after WebGPU
  eps.push('wasm' as unknown as EP);
  return eps as unknown as any;
};

let webgpuInitPromise: Promise<void> | null = null;
async function ensureWebGPUDevice() {
  if (webgpuInitPromise) return webgpuInitPromise;
  webgpuInitPromise = (async () => {
    try {
      const anyOrt = ort as any;
      if (typeof navigator !== 'undefined' && (navigator as any).gpu && !anyOrt?.env?.webgpu?.device) {
        // Ask for a high-performance adapter/device and hand it to ORT
        const adapter = await (navigator as any).gpu.requestAdapter?.({ powerPreference: 'high-performance' });
        if (adapter) {
          const device = await adapter.requestDevice?.();
          if (device && anyOrt?.env?.webgpu) {
            anyOrt.env.webgpu.device = device;
            // optional: anyOrt.env.webgpu.adapterInfo = await adapter?.requestAdapterInfo?.();
            // optional perf hint:
            anyOrt.env.webgpu.powerPreference = 'high-performance';
          }
        }
      }
    } catch (e) {
      // If anything fails, WebGPU init is optional; WASM fallback remains
      console.warn('WebGPU initialization failed, using fallback if needed', e);
    }
  })();
  return webgpuInitPromise;
}

const sessionPromise = (async () => {
  await ensureWebGPUDevice();
  return ort.InferenceSession.create(MODEL_URL, { executionProviders: pickEPs() });
})();

function imageDataToTensor(img: ImageData): ort.Tensor {
  const { width: W, height: H, data: rgba } = img;
  const chw = new Float32Array(3 * H * W);
  // NCHW indexing
  const stride = H * W;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (y * W + x) * 4;          // RGBA source index
      const di = y * W + x;                // planar index
      chw[0 * stride + di] = rgba[si + 0] / 255; // R
      chw[1 * stride + di] = rgba[si + 1] / 255; // G
      chw[2 * stride + di] = rgba[si + 2] / 255; // B
    }
  }
  return new ort.Tensor('float32', chw, [1, 3, H, W]);
}

let srcCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let dstCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;


function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function ensureCanvases(sw: number, sh: number, tw: number, th: number) {
  if (!srcCanvas) srcCanvas = makeCanvas(sw, sh); else { srcCanvas.width = sw; srcCanvas.height = sh; }
  if (!dstCanvas) dstCanvas = makeCanvas(tw, th); else { dstCanvas.width = tw; dstCanvas.height = th; }
}


function resizeToModel(image: ImageData): ImageData {
  ensureCanvases(image.width, image.height, MODEL_W, MODEL_H);
  const sctx = (srcCanvas as any).getContext('2d') as CanvasRenderingContext2D;
  const dctx = (dstCanvas as any).getContext('2d') as CanvasRenderingContext2D;
  sctx.putImageData(image, 0, 0);
  dctx.drawImage(srcCanvas as any, 0, 0, image.width, image.height, 0, 0, MODEL_W, MODEL_H);
  return dctx.getImageData(0, 0, MODEL_W, MODEL_H);
}


async function predictScores(image: ImageData): Promise<Float32Array | null> {
  if (inferBusy) return null; // drop frame if previous inference is still running
  inferBusy = true;
  try {
    const session = await sessionPromise;
    const inputName = (session as any).inputNames?.[0] ?? FALLBACK_INPUT_NAME;

    const resized = (image.width === MODEL_W && image.height === MODEL_H)
      ? image
      : resizeToModel(image);

    const tensor = imageDataToTensor(resized);
    const outputs = await session.run({ [inputName]: tensor });

    // prefer declared output name, otherwise first key
    const outName = (session as any).outputNames?.[0] ?? Object.keys(outputs)[0];
    const out = outputs[outName];
    if (!out || !(out.data instanceof Float32Array)) {
      // Handle other dtypes if your model outputs something else
      return new Float32Array(Array.from(out.data as any));
    }
    return out.data as Float32Array;
  } finally {
    inferBusy = false;
  }
}


// Placeholder hooks for AI model triggers — intentionally unimplemented per AGENT.md
export async function pullStartDetected(image: ImageData) {
  const scores = await predictScores(image);
  console.log(scores);
  if (!scores) return false; // frame dropped due to in-flight inference

  return scores[1] > START_THRESH;
}

export async function pullEndDetected(image: ImageData) {
  const scores = await predictScores(image);
  if (!scores) return false;

  return scores[2] > END_THRESH;
}

