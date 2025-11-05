import { getWebGpuContext } from './lib/utils';

/*****************************************************************************
 * Globals
 *****************************************************************************/

const width = 640;
const height = 480;

const metaData = {
  width: 75, // scene width in m
  height: 50, // scene height in m
  deltaX: 75 / width, // = width / nrPixelsWidth
  deltaY: 50 / height, // = height / nrPixelsHeight
  deltaT: 0.0001, // should not be much bigger than 0.01
};

const shipPositions = [
  {
    x: 0.5,
    y: 0.5,
    rotation: 0.0,
  },
  {
    x: 0.25,
    y: 0.25,
    rotation: Math.PI,
  },
];

const canvas = document.querySelector('#canvas') as HTMLCanvasElement;
canvas.width = width;
canvas.height = height;

const { device, context, format } = await getWebGpuContext(canvas);

/*****************************************************************************
 * Water shader
 *****************************************************************************/

const waterShader = device.createShaderModule({
  code: /*wgsl*/ `

        struct MetaData {
            width: f32,   // scene width in m
            height: f32,  // scene height in m
            deltaX: f32,  // = width / nrPixelsWidth
            deltaY: f32,  // = height / nrPixelsHeight
            deltaT: f32,  // should not be much bigger than 0.01
        }

        struct ShipPosition {
            x: f32,
            y: f32,
            rotation: f32
        }

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) uv: vec2f
        }

        struct FragmentOutput {
            @location(0) diffuseColor: vec4f,
            @location(1) huvOutput: vec4f 
        }

        const POSITIONS = array<vec2<f32>, 4>(
            vec2(-1.0, -1.0), // Bottom-left
            vec2( 1.0, -1.0), // Bottom-right
            vec2(-1.0,  1.0), // Top-left
            vec2( 1.0,  1.0)  // Top-right
        );

        const UVS = array<vec2<f32>, 4>(
            vec2(0.0, 1.0), // Bottom-left pos
            vec2(1.0, 1.0), // Bottom-right pos
            vec2(0.0, 0.0), // Top-left pos
            vec2(1.0, 0.0)  // Top-right pos
        );

        const g = 9.81;   // m/s^2
        const H = 1.0;    // bathymetry
        const k = 0.0;    // viscous drag of water
        const f = 0.523;  // coriolis coefficient

        @group(0) @binding(0) var<uniform> metaData: MetaData;
        @group(0) @binding(1) var<storage, read> shipPositions: array<ShipPosition>;
        @group(0) @binding(2) var huvTexture: texture_2d<f32>;

        // some textures cannot be sampled with 'textureSample', for instance r32f or rgba32f.
        // so we use 'textureLoad' instead.
        fn myTextureSampler(texture: texture_2d<f32>, uv: vec2f) -> vec4f {
            let textureSize = textureDimensions(texture);
            let coords = vec2<i32>(uv * vec2<f32>(textureSize));
            return textureLoad(texture, coords, 0);
        }

        fn interpolateColor(h: f32) -> vec4f {
            let hmin = 0.0;
            let hmax = 2.0;
            let colorMin = vec4f(0, 0.25, 1, 1);
            let colorMax = vec4f(0.25, 1, 1, 1);
            let dir = colorMax - colorMin;
            let fraction = (h - hmin) / (hmax - hmin);
            let interpolated = colorMin + fraction * dir;
            return interpolated;
        }

        @vertex fn vertex(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
            let triangleNr: u32 = vertexIndex / 3;
            let triangleOffset: u32 = vertexIndex % 3; 
            let pos = POSITIONS[triangleNr + triangleOffset];
            let uv = UVS[triangleNr + triangleOffset];
            var o = VertexOutput();
            o.pos = vec4f(pos, 0, 1);
            o.uv = uv;
            return o;
        }

        @fragment fn fragment(vo: VertexOutput) -> FragmentOutput {

            let dx = metaData.deltaX;
            let dy = metaData.deltaY;
            let dt = metaData.deltaT;
            let width = metaData.width;
            let height = metaData.height;

            let huv = myTextureSampler(huvTexture, vo.uv);
            let huv_xp = myTextureSampler(huvTexture, vo.uv + vec2f(dx/width, 0.0));
            let huv_yp = myTextureSampler(huvTexture, vo.uv + vec2f(0.0, dy/height));

            var h = huv[0];
            let u = huv[1];
            let v = huv[2];
            let h_xp = huv_xp[0];
            let u_xp = huv_xp[1];
            let h_yp = huv_yp[0];
            let v_yp = huv_yp[2];

            // if this is a ship location, create some distortion
            for (var s: u32 = 0; s < 2; s++) {
                let shipPos = shipPositions[0];
                let dir = vo.uv - vec2f(shipPos.x, shipPos.y);
                let dist = length(dir);
                if (dist < 0.01) {
                    h += 0.01;
                }
            }

            // shallow water equations
            let h_tp = - H * ( (u_xp - u)/dx  +  (v_yp - v)/dy ) * dt + h;
            let u_tp = ( -g * (h_xp - h)/dx  - k*u + f*v ) * dt + u;
            let v_tp = ( -g * (h_yp - h)/dy  - k*v - f*u ) * dt + v;

            var fo = FragmentOutput();
            fo.huvOutput = vec4f(h_tp, u_tp, v_tp, 1.0);
            fo.diffuseColor = interpolateColor(h_tp);
            return fo;
        }

    `,
});

const metaDataArray = new Float32Array([
  metaData.width,
  metaData.height,
  metaData.deltaX,
  metaData.deltaY,
  metaData.deltaT,
]);
const metaDataBuffer = device.createBuffer({
  label: 'metadata',
  size: metaDataArray.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(metaDataBuffer, 0, metaDataArray, 0);

const shipPosArray = new Float32Array([
  shipPositions[0].x,
  shipPositions[0].y,
  shipPositions[0].rotation,
  shipPositions[1].x,
  shipPositions[1].y,
  shipPositions[1].rotation,
]);
const shipPosBuffer = device.createBuffer({
  label: 'shipPositions',
  size: shipPosArray.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(shipPosBuffer, 0, shipPosArray, 0);

const huvTexture1 = device.createTexture({
  label: 'huvTexture1',
  format: 'rgba32float',
  size: [width, height],
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
});

const huvTexture2 = device.createTexture({
  label: 'huvTexture2',
  format: 'rgba32float',
  size: [width, height],
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
});

const waterPipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex: {
    module: waterShader,
    entryPoint: `vertex`,
  },
  fragment: {
    module: waterShader,
    targets: [
      {
        format,
      },
      {
        format: huvTexture1.format,
      },
    ],
  },
});

const waterBindgroup1 = device.createBindGroup({
  layout: waterPipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: metaDataBuffer,
    },
    {
      binding: 1,
      resource: shipPosBuffer,
    },
    {
      binding: 2,
      resource: huvTexture1.createView(),
    },
  ],
});

const waterBindgroup2 = device.createBindGroup({
  layout: waterPipeline.getBindGroupLayout(0),
  entries: [
    {
      binding: 0,
      resource: metaDataBuffer,
    },
    {
      binding: 1,
      resource: shipPosBuffer,
    },
    {
      binding: 2,
      resource: huvTexture2.createView(),
    },
  ],
});

let i = 0;
function render() {
  i += 1;

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        loadOp: 'clear',
        storeOp: 'store',
        view: context.getCurrentTexture().createView(), // todo: later, this will be the diffuseTexture instead
      },
      {
        loadOp: 'load',
        storeOp: 'store',
        view: i % 2 === 0 ? huvTexture2.createView() : huvTexture1.createView(),
      },
    ],
  });
  pass.setPipeline(waterPipeline);
  pass.setBindGroup(0, i % 2 === 0 ? waterBindgroup1 : waterBindgroup2);
  pass.draw(6);
  pass.end();
  const command = encoder.finish();
  device.queue.submit([command]);
}

function loop() {
  const startTime = new Date().getTime();

  render();

  const endTime = new Date().getTime();
  const timePassed = endTime - startTime;
  const timeLeft = 30.0 - timePassed;
  setTimeout(loop, timeLeft);
}

loop();
