import MetalKit
import UIKit

struct LensUniforms {
  var lensSize: SIMD2<Float> = .zero
  var texSize: SIMD2<Float> = .zero
  /// tab row point under the lens center, texture pixels
  var center: SIMD2<Float> = .zero
  var magnification: Float = 1
  var radius: Float = 0
  var bezel: Float = 1
  var refraction: Float = 0
  var chroma: Float = 0
  var press: Float = 0
}

/// Metal port of the Android AGSL lens. UIKit has no shaders on live views, so the row is rendered
/// to a texture once per press and only uniforms change after that. Compiled from source at runtime
/// so apps need no build settings.
final class LensShaderRenderer: NSObject, MTKViewDelegate {
  private static let device: MTLDevice? = MTLCreateSystemDefaultDevice()
  private static let pipeline: MTLRenderPipelineState? = {
    guard let device else { return nil }
    do {
      let library = try device.makeLibrary(source: source, options: nil)
      let descriptor = MTLRenderPipelineDescriptor()
      descriptor.vertexFunction = library.makeFunction(name: "lensVertex")
      descriptor.fragmentFunction = library.makeFunction(name: "lensFragment")
      descriptor.colorAttachments[0].pixelFormat = .bgra8Unorm
      return try device.makeRenderPipelineState(descriptor: descriptor)
    } catch {
      NSLog("[ExpoAdaptiveGlass] lens shader unavailable, using the plain magnifier: %@", "\(error)")
      return nil
    }
  }()

  let view: MTKView
  var uniforms = LensUniforms()
  private let queue: MTLCommandQueue
  private var texture: MTLTexture?
  private var pixels: [UInt8] = []

  init?(frame: CGRect) {
    guard let device = Self.device, Self.pipeline != nil, let queue = device.makeCommandQueue() else { return nil }
    self.queue = queue
    view = MTKView(frame: frame, device: device)
    super.init()
    view.delegate = self
    view.isPaused = true
    view.enableSetNeedsDisplay = false
    view.autoResizeDrawable = false
    view.framebufferOnly = true
    view.colorPixelFormat = .bgra8Unorm
    view.clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
    view.isOpaque = false
    view.backgroundColor = .clear
    view.isUserInteractionEnabled = false
  }

  /// once per press, never per frame
  func load(from source: UIView, scale: CGFloat) -> Bool {
    load(size: source.bounds.size, scale: scale) { _ in
      source.drawHierarchy(in: source.bounds, afterScreenUpdates: false)
    }
  }

  // MTKTextureLoader "Image decoding failed" tai, akhirnya upload manual. jangan balik ke loader
  /// Draws straight into the texture in UIKit coordinates. Reuses it while the size is the same,
  /// so small content like a switch track can be redrawn while it changes.
  @discardableResult
  func load(size: CGSize, scale: CGFloat, draw: (CGContext) -> Void) -> Bool {
    guard let device = Self.device, size.width > 0, size.height > 0 else { return false }
    let w = Int((size.width * scale).rounded(.up))
    let h = Int((size.height * scale).rounded(.up))
    if texture?.width != w || texture?.height != h {
      let descriptor = MTLTextureDescriptor.texture2DDescriptor(
        pixelFormat: .rgba8Unorm, width: w, height: h, mipmapped: false)
      descriptor.usage = .shaderRead
      texture = device.makeTexture(descriptor: descriptor)
      pixels = [UInt8](repeating: 0, count: w * h * 4)
    }
    guard let texture else { return false }
    let drawn: Bool = pixels.withUnsafeMutableBytes { buffer in
      guard
        let context = CGContext(
          data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      else { return false }
      context.clear(CGRect(x: 0, y: 0, width: w, height: h))
      context.translateBy(x: 0, y: CGFloat(h))
      context.scaleBy(x: scale, y: -scale)
      UIGraphicsPushContext(context)
      draw(context)
      UIGraphicsPopContext()
      return true
    }
    guard drawn else { return false }
    texture.replace(region: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0, withBytes: pixels, bytesPerRow: w * 4)
    uniforms.texSize = SIMD2(Float(w), Float(h))
    return true
  }

  func release() {
    texture = nil
    pixels = []
  }

  func render() {
    view.draw()
  }

  func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}

  func draw(in view: MTKView) {
    guard let texture, let pipeline = Self.pipeline, let pass = view.currentRenderPassDescriptor,
      let drawable = view.currentDrawable, let buffer = queue.makeCommandBuffer(),
      let encoder = buffer.makeRenderCommandEncoder(descriptor: pass)
    else { return }
    var u = uniforms
    u.lensSize = SIMD2(Float(view.drawableSize.width), Float(view.drawableSize.height))
    encoder.setRenderPipelineState(pipeline)
    encoder.setFragmentTexture(texture, index: 0)
    encoder.setFragmentBytes(&u, length: MemoryLayout<LensUniforms>.stride, index: 0)
    encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    encoder.endEncoding()
    buffer.present(drawable)
    buffer.commit()
  }

  private static let source = """
    #include <metal_stdlib>
    using namespace metal;

    struct Uniforms {
      float2 lensSize;
      float2 texSize;
      float2 center;
      float magnification;
      float radius;
      float bezel;
      float refraction;
      float chroma;
      float press;
    };

    struct VOut {
      float4 position [[position]];
      float2 uv;
    };

    // one full-screen triangle
    vertex VOut lensVertex(uint vid [[vertex_id]]) {
      float2 p = float2((vid << 1) & 2, vid & 2);
      VOut o;
      o.position = float4(p * 2.0 - 1.0, 0.0, 1.0);
      o.uv = float2(p.x, 1.0 - p.y);
      return o;
    }

    float roundRect(float2 p, float2 size, float r) {
      float2 h = size * 0.5;
      float2 q = abs(p - h) - h + r;
      return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    }

    fragment float4 lensFragment(VOut in [[stage_in]],
                                 texture2d<float> tex [[texture(0)]],
                                 constant Uniforms& u [[buffer(0)]]) {
      constexpr sampler s(address::clamp_to_zero, filter::linear);
      float2 p = in.uv * u.lensSize;
      float d = roundRect(p, u.lensSize, u.radius);
      if (d > 0.5) return float4(0.0);
      // 0 across the flat middle, 1 at the rim
      float x = clamp(1.0 + d / max(u.bezel, 1.0), 0.0, 1.0);
      float2 e = float2(1.0, 0.0);
      float2 n = normalize(float2(roundRect(p + e.xy, u.lensSize, u.radius) - roundRect(p - e.xy, u.lensSize, u.radius),
                                  roundRect(p + e.yx, u.lensSize, u.radius) - roundRect(p - e.yx, u.lensSize, u.radius)) + 0.0001);
      float bend = u.refraction * x * x * x;
      float2 at = p - n * bend;
      float2 mid = u.lensSize * 0.5;
      float2 texAt = u.center + (at - mid) / u.magnification;
      float4 color = tex.sample(s, texAt / u.texSize);
      if (u.chroma > 0.0 && bend > 0.5) {
        float2 spread = n * (u.chroma * bend * 0.08) / u.magnification;
        color.r = tex.sample(s, (texAt - spread) / u.texSize).r;
        color.b = tex.sample(s, (texAt + spread) / u.texSize).b;
      }
      // glints on the rim facing the light (top-left) and the opposite edge
      float2 l = normalize(float2(-1.0, -1.2));
      float facing = max(dot(n, l), 0.0);
      float backing = max(-dot(n, l), 0.0);
      float edge = pow(x, 6.0);
      float spec = edge * (0.9 * pow(facing, 3.0) + 0.25 * pow(backing, 3.0)) * u.press;
      color.rgb += spec * 0.55 * color.a;
      return color;
    }
    """
}
