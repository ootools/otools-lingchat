declare module 'onnxruntime-web/wasm' {
  export const env: { wasm: { numThreads: number; wasmPaths: string } };
  export const Tensor: unknown;
  export const InferenceSession: unknown;
}
