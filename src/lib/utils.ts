export async function getWebGpuContext(canvas: HTMLCanvasElement) {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice();
  if (!device) throw new Error(`No support for WebGPU`);
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error(`No support for WebGPU`);
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });
  return { device, context, format };
}
