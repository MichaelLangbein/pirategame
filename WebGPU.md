# Storage buffers vs uniform buffers

- uniform buffers are read only
- uniform buffers must be fixed size, cannot be `array`
- storage buffers can be much larger
- uniform buffers are faster for ...

# Instancing

- active by default
- simply add `draw(<vertexCount>, <instanceCount>)`
-

# Textures

- Not all textures can be read by a sampler
- A sampler really only serves to facilitate between pixel interpolation (with hardware acceleration)
- Some texture formats (like r32f and rgba32f) cannot be accessed with a sampler
- For those, use `textureLoad` instead of `textureSample`
