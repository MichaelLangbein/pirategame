# WebGPU

Some details I've learned

## Storage buffers vs uniform buffers

- uniform buffers are read only
- uniform buffers must be fixed size, cannot be `array`
- storage buffers can be much larger
- uniform buffers are faster for ...

## Instancing

- active by default
- simply add `draw(<vertexCount>, <instanceCount>)`

## Textures

- Not all textures can be read by a sampler
  - A sampler really only serves to facilitate between pixel interpolation (with hardware acceleration)
  - Some texture formats (like r32f and rgba32f, but also rgba8u) cannot be accessed with a sampler
  - For those, use `textureLoad` instead of `textureSample`
- Another issue is that webgpu doesn't know u8 datatypes
  - you can create a rgba8u texture ... but that will automatically get converted to a `texture_2d<u32>` texture.
  - Note that also rgba8u cannot be read with textureSample, only with textureLoad
  - Note also that `copyExternalImageToTexture` expects the target to be `rgba8unorm` (emphasis on the _norm_) anyway ... which means that you actually do need a `texture_2d<f32>`
