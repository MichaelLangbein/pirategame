/**
 * TODOs
 * =====
 *
 * - triangle .................. done
 * - buffer .................... done
 * - colored triangle .......... done
 * - instancing ................ done
 * - animation ................. done
 * - rotation matrix ........... done
 * - quad ...................... done
 * - load texture .............. done
 * - display texture ........... done
 * - large canvas, few pixels
 *
 */

const width = 320;
const height = 240;

const canvas = document.querySelector('#canvas') as HTMLCanvasElement;
canvas.width = width;
canvas.height = height;

const shipImgResponse = await fetch('./ship.png');
const blob = await shipImgResponse.blob();
const shipBitmap = await createImageBitmap(blob, { resizeHeight: 20, resizeWidth: 20 });
console.log(shipBitmap);

const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();
if (!device) throw new Error(`No support for WebGPU`);
const context = canvas.getContext('webgpu');
if (!context) throw new Error(`No support for WebGPU`);
const format = navigator.gpu.getPreferredCanvasFormat();
context?.configure({ device, format });

const shader = device.createShaderModule({
  code: /*wgsl*/ `

    const POSITIONS = array<vec2<f32>, 4>(
      vec2(-1.0, -1.0), // Bottom-left
      vec2( 1.0, -1.0), // Bottom-right
      vec2(-1.0,  1.0), // Top-left
      vec2( 1.0,  1.0)  // Top-right
    );

    const UVS = array<vec2<f32>, 4>(
      vec2(0.0, 1.0), // Corresponds to Bottom-left pos
      vec2(1.0, 1.0), // Corresponds to Bottom-right pos
      vec2(0.0, 0.0), // Corresponds to Top-left pos
      vec2(1.0, 0.0)  // Corresponds to Top-right pos
    );

    struct Transform {
      offset: vec2f,
      rotation: f32,
      scale: f32
    }

    struct VertexOutput {
      @builtin(position) pos: vec4f,
      @location(0) uv: vec2f,
    }

    @group(0) @binding(0) var<storage, read> transforms: array<Transform>;
    @group(0) @binding(1) var textureSampler: sampler;
    @group(0) @binding(2) var texture:texture_2d<f32>;

    @vertex fn vertex(
      @builtin(vertex_index) vertexIndex: u32, 
      @builtin(instance_index) instanceIndex: u32
    ) -> VertexOutput {

      let triangleNr: u32 = vertexIndex / 3;
      let triangleOffset: u32 = vertexIndex % 3; 
      let pos = POSITIONS[triangleNr + triangleOffset];
      let uv = UVS[triangleNr + triangleOffset];

      let transform = transforms[instanceIndex];
      let offset = transform.offset;
      let rotation = transform.rotation;
      let scl = transform.scale;

      let c = cos(rotation);
      let s = sin(rotation);
      let rotMatrix = mat2x2f(c, s, -s, c);
      let new_pos_xy = (rotMatrix * pos.xy) * scl + offset;

      var output = VertexOutput();
      output.uv = uv;
      output.pos = vec4f(new_pos_xy, 0, 1);
      
      return output;
    }

    @fragment fn fragment(vOut: VertexOutput) -> @location(0) vec4f {
      let color = textureSample(texture, textureSampler, vOut.uv);
      return color;
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

const transformData = new Float32Array([
  // offset
  0.2, 0.3,
  // rotation,
  0.1,
  // scale
  0.5,

  // offset
  -0.2, -0.3,
  // rotation,
  -0.1,
  // scale
  0.3,
]);

const transformBuffer = device.createBuffer({
  label: `transformBuffer`,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  size: transformData.byteLength,
});

const shipTexture = device.createTexture({
  format: 'rgba8unorm',
  size: { width: 20, height: 20 },
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
});


const textureSampler = device.createSampler({});

device.queue.writeBuffer(transformBuffer, 0, transformData, 0);
device.queue.copyExternalImageToTexture(
  { source: shipBitmap },
  { texture: shipTexture },
  { width: 20, height: 20 }
);

const bindgroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: transformBuffer,
    },
    {
      binding: 1,
      resource: textureSampler,
    },
    {
      binding: 2,
      resource: shipTexture.createView(),
    },
  ],
});

function onRender(device: GPUDevice, context: GPUCanvasContext) {
  transformData[0] = (transformData[0] + 0.001) % 1.0;
  transformData[1] = (transformData[1] + 0.001) % 1.0;
  transformData[4] = (transformData[4] + 0.002) % 1.0;
  transformData[5] = (transformData[5] + 0.002) % 1.0;

  device.queue.writeBuffer(transformBuffer, 0, transformData);

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
  pass.draw(6, 2);
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
