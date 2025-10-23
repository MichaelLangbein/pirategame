/**
 * TODOs
 * =====
 *
 * - triangle ............... done
 * - buffer .....
 * - instancing
 * - rotation
 *
 */

const width = 320;
const height = 240;

const canvas = document.querySelector('#canvas') as HTMLCanvasElement;
canvas.width = width;
canvas.height = height;
const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();
if (!device) throw new Error(`No support for WebGPU`);
const context = canvas.getContext('webgpu');
if (!context) throw new Error(`No support for WebGPU`);
const format = navigator.gpu.getPreferredCanvasFormat();
context?.configure({ device, format });

const targetTextureView = context.getCurrentTexture().createView();

const shader = device.createShaderModule({
  code: /*wgsl*/ `

    @group(0) @binding(0) var<storage, read> buffer: array<f32>; 

    @vertex fn vertex(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
      let i = vertexIndex * 2;
      let j = i + 1;
      return vec4f(buffer[i], buffer[j], 0.0, 1.0);
    }

    @fragment fn fragment() -> @location(0) vec4f {
      return vec4f(1, 0, 0, 1);
    }
  `,
});

const pipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex: {
    module: shader,
    entryPoint: 'vertex',
  },
  fragment: {
    module: shader,
    entryPoint: 'fragment',
    targets: [{ format }],
  },
});

const bufferData = new Float32Array([
  // bottom left
  -0.5, -0.5,
  // bottom right
  0.5, -0.5,
  // top
  0.0, 0.5,
]);

const buffer = device.createBuffer({
  usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  size: bufferData.byteLength,
});

device.queue.writeBuffer(buffer, 0, bufferData, 0);

const bindgroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: buffer,
    },
  ],
});

const encoder = device.createCommandEncoder();

const pass = encoder.beginRenderPass({
  colorAttachments: [
    {
      view: targetTextureView,
      loadOp: 'load',
      storeOp: 'store',
    },
  ],
});
pass.setPipeline(pipeline);
pass.setBindGroup(0, bindgroup);
pass.draw(3);
pass.end();

const commandBuffer = encoder.finish();
device.queue.submit([commandBuffer]);
