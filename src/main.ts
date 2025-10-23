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

// buffer
// bindgroup

const targetTextureView = context.getCurrentTexture().createView();

const shader = device.createShaderModule({
  code: /*wgsl*/ `

    @vertex fn vertex(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
        let pos = array(
          vec2f( 0.0,  0.5),
          vec2f(-0.5, -0.5),
          vec2f( 0.5, -0.5)
        );
        return vec4f(pos[vertexIndex], 0.0, 1.0);
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
pass.draw(3);
pass.end();

const commandBuffer = encoder.finish();
device.queue.submit([commandBuffer]);
