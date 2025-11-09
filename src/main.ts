import { getWebGpuContext } from './lib/utils';

/**
 *
 */

/*****************************************************************************
 * Globals
 *****************************************************************************/

const widthPx = 320;
const heightPx = 240;
const widthM = 75;
const heightM = 50;


const ships = [
  {
    xM: widthM / 2,
    yM: heightM / 2,
    rotationRad: 0.0,
    scaleClip: 0.15,
  },
  {
    xM: 3 * widthM / 4,
    yM: heightM / 4,
    rotationRad: Math.PI / 4,
    scaleClip: 0.1,
  },
];

const metaData = {
  widthM: widthM, // scene width in m
  heightM: heightM, // scene height in m
  deltaX: widthM / widthPx, // = width / nrPixelsWidth
  deltaY: heightM / heightPx, // = height / nrPixelsHeight
  deltaT: 0.05, // should not be much bigger than 0.01
  shipCount: ships.length
};


const canvas = document.querySelector('#canvas') as HTMLCanvasElement;
canvas.width = widthPx;
canvas.height = heightPx;

const { device, context, format } = await getWebGpuContext(canvas);


/*****************************************************************************
 * Water shader
 *****************************************************************************/

const waterShader = device.createShaderModule({
  code: /*wgsl*/ `

        struct MetaData {
            widthM: f32,   // scene width in m
            heightM: f32,  // scene height in m
            deltaX: f32,  // = width / nrPixelsWidth
            deltaY: f32,  // = height / nrPixelsHeight
            deltaT: f32,  // should not be much bigger than 0.01
            shipCount: f32  // only a float for consistency
        }

        struct Ship {
            xM: f32,
            yM: f32,
            rotationRad: f32,
            scaleClip: f32
        }

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) uv: vec2f
        }

        struct FragmentOutput {
            @location(0) diffuseColor: vec4f,
            @location(1) vhOutput: vec4f 
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

        @group(0) @binding(0) var<uniform> metaData: MetaData;
        @group(0) @binding(1) var<storage, read> shipPositions: array<Ship>;
        @group(0) @binding(2) var vhTexture: texture_2d<f32>;

        fn worldCoordsToUv(worldCoords: vec2f) -> vec2f {
          return vec2f(
            worldCoords.x / metaData.widthM,
            worldCoords.y / metaData.heightM
          );
        }

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
            let colorMin = vec4f(0.5, 0.25, 0.5, 1); // vec4f(0, 0.25, 1, 1);
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
            let width = metaData.widthM;
            let height = metaData.heightM;
            let delta = worldCoordsToUv(vec2f(dx, dy));

            let vh = myTextureSampler(vhTexture, vo.uv);
            let vh_xp = myTextureSampler(vhTexture, vo.uv + vec2f(delta.x, 0));
            let vh_xm = myTextureSampler(vhTexture, vo.uv - vec2f(delta.x, 0));
            let vh_yp = myTextureSampler(vhTexture, vo.uv + vec2f(0, delta.y));
            let vh_ym = myTextureSampler(vhTexture, vo.uv - vec2f(0, delta.y));

            let v1 = vh.x;
            let h1 = vh.y;
            let h1_xp = vh_xp.y;
            let h1_xm = vh_xm.y;
            let h1_yp = vh_yp.y;
            let h1_ym = vh_ym.y;

            // water simulation
            var v2 = v1 + dt * ( h1_xp + h1_xm + h1_yp + h1_ym - 4.0 * h1 ) / (dx * dy);
            v2 *= 0.999;
            var h2 = h1 + dt * v2;


            // if this is a ship location, create some distortion
            for (var s: u32 = 0; s < u32(metaData.shipCount); s++) {
                let shipPosM = shipPositions[s];
                let shipPosUv = worldCoordsToUv(vec2f(shipPosM.xM, shipPosM.yM));
                let dir = vo.uv - shipPosUv;
                let dist = length(dir);
                if (dist < 0.01) {
                    h2 += 0.01;
                }
            }

            var fo = FragmentOutput();
            fo.vhOutput = vec4f(v2, h2, 0, 1.0);
            fo.diffuseColor = interpolateColor(h2);
            return fo;
        }

    `,
});

const metaDataArray = new Float32Array([
  metaData.widthM,
  metaData.heightM,
  metaData.deltaX,
  metaData.deltaY,
  metaData.deltaT,
  metaData.shipCount
]);
const metaDataBuffer = device.createBuffer({
  label: 'metadata',
  size: metaDataArray.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(metaDataBuffer, 0, metaDataArray, 0);

const shipPosArray = new Float32Array([
  ships[0].xM,
  ships[0].yM,
  ships[0].rotationRad,
  ships[0].scaleClip,
  ships[1].xM,
  ships[1].yM,
  ships[1].rotationRad,
  ships[1].scaleClip
]);
const shipPosBuffer = device.createBuffer({
  label: 'shipPositions',
  size: shipPosArray.byteLength,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(shipPosBuffer, 0, shipPosArray, 0);

const vhTexture1 = device.createTexture({
  label: 'vhTexture1',
  format: 'rgba32float',
  size: [widthPx, heightPx],
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
});

const vhTexture2 = device.createTexture({
  label: 'vhTexture2',
  format: 'rgba32float',
  size: [widthPx, heightPx],
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
        format: vhTexture1.format,
      },
    ],
  },
});

const waterBindGroup1 = device.createBindGroup({
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
      resource: vhTexture1.createView(),
    },
  ],
});

const waterBindGroup2 = device.createBindGroup({
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
      resource: vhTexture2.createView(),
    },
  ],
});



/*****************************************************************************
 * Ship shader
 *****************************************************************************/

const shipShader = device.createShaderModule({
  label: `shipShader`,
  code: /*wgsl*/`
  
        struct MetaData {
            widthM: f32,   // scene width in m
            heightM: f32,  // scene height in m
            deltaX: f32,  // = width / nrPixelsWidth
            deltaY: f32,  // = height / nrPixelsHeight
            deltaT: f32,  // should not be much bigger than 0.01
            shipCount: f32  // only a float for consistency
        }

        struct Ship {
            xM: f32,
            yM: f32,
            rotationRad: f32,
            scaleClip: f32,
        }

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) uv: vec2f
        }

        struct FragmentOutput {
            @location(0) diffuseColor: vec4f,
            @location(1) heightMap: f32
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

        @group(0) @binding(0) var<uniform> metaData: MetaData;
        @group(0) @binding(1) var<storage, read> shipPositions: array<Ship>;
        @group(0) @binding(2) var vhTexture: texture_2d<f32>;
        @group(0) @binding(3) var shipTexture: texture_2d<f32>;
        @group(0) @binding(4) var shipHeightTexture: texture_2d<f32>;

        fn worldCoordsToUv(worldCoords: vec2f) -> vec2f {
          return vec2f(
            worldCoords.x / metaData.widthM,
            worldCoords.y / metaData.heightM
          );
        }

        // some textures cannot be sampled with 'textureSample', for instance r32f or rgba32f.
        // so we use 'textureLoad' instead.
        fn myTextureSampler_f32(texture: texture_2d<f32>, uv: vec2f) -> vec4f {
            let textureSize = textureDimensions(texture);
            let coords = vec2<i32>(uv * vec2<f32>(textureSize));
            return textureLoad(texture, coords, 0);
        }
        fn myTextureSampler_u32(texture: texture_2d<u32>, uv: vec2f) -> vec4<u32> {
            let textureSize = textureDimensions(texture);
            let coords = vec2<i32>(uv * vec2<f32>(textureSize));
            return textureLoad(texture, coords, 0);
        }

        fn getRotationMatrix(radsAroundX: f32, radsAroundY: f32, radsAroundZ: f32) -> mat3x3<f32> {
          let rx = mat3x3(
            1, 0, 0,
            0, cos(radsAroundX), -sin(radsAroundX),
            0, sin(radsAroundX), cos(radsAroundX)
          );
          let ry = mat3x3(
            cos(radsAroundY), 0, sin(radsAroundY),
            0, 1, 0,
            -sin(radsAroundY), 0, cos(radsAroundY)
          );
          let rz = mat3x3(
            cos(radsAroundZ), - sin(radsAroundZ), 0,
            sin(radsAroundZ), cos(radsAroundZ), 0,
            0, 0, 1
          );
          return rx * ry * rz;
        }

        fn getShipH(shipPosWorldX: f32, shipPosWorldY: f32) -> f32 {
          let shipPosUv = worldCoordsToUv(vec2f(shipPosWorldX, shipPosWorldY));
          let h = myTextureSampler_f32(vhTexture, shipPosUv).y;
          return h;
        }

        fn getShipPosRotation(shipPosWorldX: f32, shipPosWorldY: f32) -> vec2f {
          let shipPosUv = worldCoordsToUv(vec2f(shipPosWorldX, shipPosWorldY));
          let h = myTextureSampler_f32(vhTexture, shipPosUv).y;
          let h_yp = myTextureSampler_f32(vhTexture, shipPosUv + vec2f(0, metaData.deltaY / metaData.heightM)).y;
          let h_xp = myTextureSampler_f32(vhTexture, shipPosUv + vec2f(metaData.deltaX / metaData.heightM, 0)).y;
          let rotationXRads = atan((h_yp - h) / metaData.deltaY);
          let rotationYRads = atan((h_xp - h) / metaData.deltaX);
          return vec2f(rotationXRads, rotationYRads);
        }

        @vertex fn vertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
            let triangleNr: u32 = vertexIndex / 3;
            let triangleOffset: u32 = vertexIndex % 3; 
            let pos = POSITIONS[triangleNr + triangleOffset];
            let uv = UVS[triangleNr + triangleOffset];

            // ship world pos
            let ship = shipPositions[instanceIndex];
            let h = getShipH(ship.xM, ship.yM);
            let shipWorldPos = vec3f(ship.xM, ship.yM, h);

            // scale
            let scaled = vec3f(pos * ship.scaleClip, 0.0);

            // rotate
            let rotationXY = getShipPosRotation(ship.xM, ship.yM);
            let rotationZ = ship.rotationRad;
            let rotationMatrix = getRotationMatrix(rotationXY.x, rotationXY.y, rotationZ);
            let rotated = rotationMatrix * scaled;

            // translate
            let translated = vec3f(
              rotated.x + 2.0 * ship.xM / metaData.widthM - 1.0,
              rotated.y - 2.0 * ship.yM / metaData.heightM + 1.0,
              h
            );

            var o = VertexOutput();
            o.pos = vec4f(translated, 1);
            o.uv = uv;
            return o;
        }

        @fragment fn fragment(vo: VertexOutput) -> FragmentOutput {
            let shipColor = myTextureSampler_f32(shipTexture, vo.uv);
            let shipHeight = myTextureSampler_f32(shipHeightTexture, vo.uv).x;
            let waterHeight = myTextureSampler_f32(vhTexture, vo.uv).y;
            var fo = FragmentOutput();
            fo.diffuseColor = shipColor;
            fo.heightMap = waterHeight + shipHeight;
            return fo;
        }
  `
});


const shipImgResponse = await fetch('./ship.png');
const blob = await shipImgResponse.blob();
const shipBitmap = await createImageBitmap(blob, { resizeHeight: 100, resizeWidth: 100 });
const shipTexture = device.createTexture({
  label: 'shipTexture',
  format: 'rgba8unorm',
  size: [100, 100],
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
});
device.queue.copyExternalImageToTexture({source: shipBitmap}, {texture: shipTexture}, {width: 100, height: 100});

const shipHeightImgResponse = await fetch('./shipHeight.png');
const heightBlob = await shipHeightImgResponse.blob();
const shipHeightBitmap = await createImageBitmap(heightBlob, { resizeHeight: 100, resizeWidth: 100 });
const shipHeightTexture = device.createTexture({
  label: 'shipHeightTexture',
  format: 'rgba8unorm',
  size: [100, 100],
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
});
device.queue.copyExternalImageToTexture({source: shipHeightBitmap}, {texture: shipHeightTexture}, {width: 100, height: 100});

const waterAndShipHeightTexture = device.createTexture({
  format: 'r32float',
  size: [widthPx, heightPx],
  usage: GPUTextureUsage.RENDER_ATTACHMENT
});

const shipPipeline = device.createRenderPipeline({
  layout: 'auto',
  vertex: {
    module: shipShader,
    entryPoint: `vertex`,
  }, 
  fragment: {
    module: shipShader,
    targets: [{
      format
    }, {
      format: waterAndShipHeightTexture.format
    }]
  }
});

const shipBindGroup1 = device.createBindGroup({
  label: 'shipBindGroup1', 
  layout: shipPipeline.getBindGroupLayout(0),
  entries: [{
    binding: 0,
    resource: metaDataBuffer
  }, {
    binding: 1, resource: shipPosBuffer
  }, {
    binding: 2, resource: vhTexture1.createView(),
  }, {
    binding: 3, resource: shipTexture.createView(),
  }, {
    binding: 4, resource: shipHeightTexture.createView(),
  }]
});

const shipBindGroup2 = device.createBindGroup({
  label: 'shipBindGroup2', 
  layout: shipPipeline.getBindGroupLayout(0),
  entries: [{
    binding: 0,
    resource: metaDataBuffer
  }, {
    binding: 1, resource: shipPosBuffer
  }, {
    binding: 2, resource: vhTexture2.createView(),
  }, {
    binding: 3, resource: shipTexture.createView(),
  }, {
    binding: 4, resource: shipHeightTexture.createView(),
  }]
});

/*****************************************************************************
 * Render loop
 *****************************************************************************/

let i = 0;
function render() {
  i += 1;

  shipPosArray[0] = 0.5 * widthM * Math.cos(i / 100) + widthM / 2;
  device.queue.writeBuffer(shipPosBuffer, 0, shipPosArray, 0);

  // water rendering

  const encoder = device.createCommandEncoder();
  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        loadOp: 'clear',
        storeOp: 'store',
        view: context.getCurrentTexture().createView()
      },
      {
        loadOp: 'load',
        storeOp: 'store',
        view: i % 2 === 0 ? vhTexture2.createView() : vhTexture1.createView(),
      },
    ],
  });
  pass.setPipeline(waterPipeline);
  pass.setBindGroup(0, i % 2 === 0 ? waterBindGroup1 : waterBindGroup2);
  pass.draw(6);
  pass.end();
  const command = encoder.finish();


  // ship rendering

  const encoder2 = device.createCommandEncoder();
  const pass2 = encoder2.beginRenderPass({
    colorAttachments: [{
      loadOp: 'load', 
      storeOp: 'store', 
      view: context.getCurrentTexture().createView()
    }, {
      loadOp: 'load', 
      storeOp: 'store', 
      view: waterAndShipHeightTexture.createView()
    }]
  });
  pass2.setPipeline(shipPipeline);
  pass2.setBindGroup(0, i % 2 === 0 ? shipBindGroup2 : shipBindGroup1);
  pass2.draw(6, metaData.shipCount);
  pass2.end();
  const command2 = encoder2.finish();

  device.queue.submit([command, command2]);
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
