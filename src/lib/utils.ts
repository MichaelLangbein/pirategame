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



export async function createTextureDisplayPass(targetCanvas: HTMLCanvasElement, texture: GPUTexture) {

  const {device, context, format} = await getWebGpuContext(targetCanvas);

  const displayShader = device.createShaderModule({
    label: `displayTextureShader`,
    code: /*wgsl*/ `

        struct VertexOutput {
            @builtin(position) pos: vec4f,
            @location(0) uv: vec2f
        }

        struct FragmentOutput {
            @location(0) color: vec4f
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

        @group(0) @binding(0) var texture: texture_2d<f32>;

        // some textures cannot be sampled with 'textureSample', for instance r32f or rgba32f.
        // so we use 'textureLoad' instead.
        fn myTextureSampler(texture: texture_2d<f32>, uv: vec2f) -> vec4f {
            let textureSize = textureDimensions(texture);
            let coords = vec2<i32>(uv * vec2<f32>(textureSize));
            return textureLoad(texture, coords, 0);
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
          var fo = FragmentOutput();
          fo.color = myTextureSampler(texture, vo.uv);
          return fo;
        }
    `
  });

  const displayTexturePipeline = device.createRenderPipeline({
    label: `displayTexturePipeline`,
    layout: 'auto',
    vertex: {
      module: displayShader,
      entryPoint: `vertex`
    },
    fragment: {
      module: displayShader,
      entryPoint: `fragment`,
      targets: [{
        format
      }]
    }
  });

  const bindGroup = device.createBindGroup({
    layout: displayTexturePipeline.getBindGroupLayout(0),
    entries: [{
      binding: 0,
      resource: texture.createView()
    }]
  });

  function displayPass() {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        loadOp: 'clear',
        storeOp: 'store',
        view: context.getCurrentTexture().createView()
      }]
    });
    pass.setPipeline(displayTexturePipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(6);
    pass.end();
    const command = encoder.finish();
    device.queue.submit([command]);
  }

  return displayPass;
}