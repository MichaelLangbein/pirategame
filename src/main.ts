/**
 * TODOs
 * =====
 *
 * - triangle ............... done
 * - buffer ................. done
 * - colored triangle ....... done
 * - instancing ............. done
 * - animation .............. done
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

    struct VertexInput {
      pos: vec4f,
      color: vec4f,
    }

    struct Transform {
      offset: vec2f,
      rotation: f32,
      scale: f32
    }

    struct VertexOutput {
      @builtin(position) pos: vec4f,
      @location(0) color: vec4f,
    }

    @group(0) @binding(0) var<storage, read> vertexInputs: array<VertexInput>;
    @group(0) @binding(1) var<storage, read> transforms: array<Transform>;


    @vertex fn vertex(
      @builtin(vertex_index) vertexIndex: u32, 
      @builtin(instance_index) instanceIndex: u32
    ) -> VertexOutput {

      let vertexInput: VertexInput = vertexInputs[vertexIndex];
      let pos = vertexInput.pos;
      let color = vertexInput.color;

      let transform = transforms[instanceIndex];
      let offset = vec4f(transform.offset, 0, 0);
      let rotation = transform.rotation;
      let scl = transform.scale;

      var output = VertexOutput();
      output.color = color;
      output.pos = vec4f(pos * scl + offset);
      
      return output;
    }

    @fragment fn fragment(vOut: VertexOutput) -> @location(0) vec4f {
      return vOut.color;
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

const inputData = new Float32Array([
  // position bottom left
  -0.5, -0.5, 0, 1,
  // color bottom left
  1, 0, 0, 1,

  // position bottom right
  0.5, -0.5, 0, 1,
  // color bottom right
  0, 1, 0, 1,

  // position top
  0.0, 0.5, 0, 1,
  // color top
  0, 0, 1, 1,
]);

const inputBuffer = device.createBuffer({
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  size: inputData.byteLength,
});

const transformData = new Float32Array([
  // offset
  0.2, 0.3,
  // rotation,
  2.1,
  // scale
  2.1,

  // offset
  -0.2, -0.3,
  // rotation,
  1.1,
  // scale
  0.5,
]);

const transformBuffer = device.createBuffer({
  label: `transformBuffer`,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  size: transformData.byteLength,
});

device.queue.writeBuffer(inputBuffer, 0, inputData, 0);
device.queue.writeBuffer(transformBuffer, 0, transformData, 0);

const bindgroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: inputBuffer,
    },
    {
      binding: 1,
      resource: transformBuffer,
    },
  ],
});

let offset1 = 0.0;
let offset2 = 0.0;

function onRender(device: GPUDevice, context: GPUCanvasContext) {
  offset1 = (offset1 + 0.01) % 2.0;
  offset2 = (offset2 + 0.01) % 2.0;

  const newOffset1Data = new Float32Array([transformData[0] + offset1, transformData[1] + offset1]);
  device.queue.writeBuffer(transformBuffer, 0, newOffset1Data, 0, newOffset1Data.length);

  const newOffset2Data = new Float32Array([transformData[4] + offset2, transformData[5] + offset2]);
  device.queue.writeBuffer(transformBuffer, 4 * 4, newOffset2Data, 0, newOffset2Data.length);

  const encoder = device.createCommandEncoder();

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        clearValue: [0.3, 0.3, 0.3, 1],
        loadOp: 'clear',
        storeOp: 'store',
      },
    ],
  });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindgroup);
  pass.draw(3, 2);
  pass.end();

  const commandBuffer = encoder.finish();
  device.queue.submit([commandBuffer]);
}

function loop(device: GPUDevice, context: GPUCanvasContext) {
  const startTime = new Date().getTime();

  onRender(device, context);

  const endTime = new Date().getTime();
  const timeLeft = 30 - (endTime - startTime);
  setTimeout(() => loop(device, context), timeLeft);
}

loop(device, context);
