import ExpoModulesCore
import UIKit

/// Merges nearby glass surfaces into one shape. iOS 26 uses UIGlassContainerEffect. Before that the
/// group draws the smooth union of the members' rects as a mask over one shared blur view,
/// re-rasterised only when a member moved.
final class GlassGroupView: ExpoView {
  var spacing: CGFloat = 20
  var intensity: CGFloat = 0.6
  var glassTint: UIColor?
  var tintScheme = "system"

  private let container = UIVisualEffectView(effect: nil)
  private var members: [WeakMember] = []
  private var systemMerging = false

  // iOS < 26
  private let shape = UIView()
  private let shapeBlur = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterial))
  private let shapeFill = UIView()
  private let shapeMask = CALayer()
  private let rim = CALayer()
  private var link: CADisplayLink?
  private var lastRects: [CGRect] = []
  private var lastRadii: [CGFloat] = []

  private final class WeakMember {
    weak var view: ExpoAdaptiveGlassView?
    init(_ v: ExpoAdaptiveGlassView) { view = v }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    shape.isUserInteractionEnabled = false
    shape.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    shapeBlur.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    shapeFill.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    shape.addSubview(shapeBlur)
    shape.addSubview(shapeFill)
    shape.layer.mask = shapeMask
    shape.layer.addSublayer(rim)
    shapeMask.contentsGravity = .resize
    rim.contentsGravity = .resize
    addSubview(shape)
    addSubview(container)
  }

  // MARK: - children

  override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    container.contentView.insertSubview(childComponentView, at: index)
  }

  override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    childComponentView.removeFromSuperview()
  }

  // MARK: - lifecycle

  override func layoutSubviews() {
    super.layoutSubviews()
    container.frame = bounds
    shape.frame = bounds
    applyEffect()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateLink()
  }

  func propsDidUpdate() {
    let style: UIUserInterfaceStyle =
      tintScheme == "light" ? .light : tintScheme == "dark" ? .dark : .unspecified
    if overrideUserInterfaceStyle != style { overrideUserInterfaceStyle = style }
    appliedSpacing = nil
    setNeedsLayout()
    lastRects = []
  }

  private var appliedSpacing: CGFloat?

  private func applyEffect() {
    guard appliedSpacing != spacing else { return }
    appliedSpacing = spacing
    #if compiler(>=6.2)
    if #available(iOS 26.0, *), GlassCapabilityDetector.supportsSystemGlass,
      NSClassFromString("UIGlassContainerEffect") != nil
    {
      let effect = UIGlassContainerEffect()
      effect.spacing = spacing
      container.effect = effect
      systemMerging = true
    }
    #endif
    shape.isHidden = systemMerging
    members.forEach { $0.view?.setGrouped(!systemMerging) }
    updateLink()
  }

  // MARK: - members

  /// returns true when the member should stop drawing its own glass
  func register(_ member: ExpoAdaptiveGlassView) -> Bool {
    members.removeAll { $0.view == nil || $0.view === member }
    members.append(WeakMember(member))
    lastRects = []
    updateLink()
    return !systemMerging
  }

  func unregister(_ member: ExpoAdaptiveGlassView) {
    members.removeAll { $0.view == nil || $0.view === member }
    lastRects = []
    updateLink()
  }

  // MARK: - fallback shape

  // members can move any frame, so poll them, but re-rasterise only on actual movement
  private func updateLink() {
    let wanted = !systemMerging && window != nil && !members.isEmpty
    if wanted, link == nil {
      let l = CADisplayLink(target: GroupLinkProxy(self), selector: #selector(GroupLinkProxy.tick(_:)))
      l.add(to: .main, forMode: .common)
      link = l
    } else if !wanted, let l = link {
      l.invalidate()
      link = nil
    }
  }

  fileprivate func tick() {
    var rects: [CGRect] = []
    var radii: [CGFloat] = []
    for box in members {
      guard let m = box.view, m.window != nil, !m.isHidden else { continue }
      // presentation layer so in-flight animations are followed
      let layer = m.glassLayer.presentation() ?? m.glassLayer
      let r = layer.convert(layer.bounds, to: self.layer)
      rects.append(r)
      radii.append(min(m.cornerRadius, min(r.width, r.height) / 2))
    }
    guard rects != lastRects || radii != lastRadii else { return }
    lastRects = rects
    lastRadii = radii
    rasterise(rects: rects, radii: radii)
  }

  // reallocated only when the group resizes
  private var alphaBuffer: [UInt8] = []
  private var lightBuffer: [UInt8] = []

  private func rasterise(rects: [CGRect], radii: [CGFloat]) {
    let dark = traitCollection.userInterfaceStyle == .dark
    let base = glassTint ?? (dark ? UIColor(white: 0.1, alpha: 1) : UIColor(white: 1, alpha: 1))
    shapeFill.backgroundColor = base.withAlphaComponent((dark ? 0.12 : 0.08) + 0.22 * intensity)
    guard !rects.isEmpty, bounds.width > 0, bounds.height > 0 else {
      shapeMask.contents = nil
      rim.contents = nil
      return
    }
    // half resolution, the mask scales up smoothly and it's 4x less work
    let step: CGFloat = 2
    let w = Int((bounds.width / step).rounded(.up))
    let h = Int((bounds.height / step).rounded(.up))
    if alphaBuffer.count != w * h {
      alphaBuffer = [UInt8](repeating: 0, count: w * h)
      lightBuffer = [UInt8](repeating: 0, count: w * h * 4)
    } else {
      alphaBuffer.withUnsafeMutableBytes { _ = $0.initializeMemory(as: UInt8.self, repeating: 0) }
      lightBuffer.withUnsafeMutableBytes { _ = $0.initializeMemory(as: UInt8.self, repeating: 0) }
    }
    let k = max(spacing, 1)

    func field(_ x: CGFloat, _ y: CGFloat) -> CGFloat {
      var d = CGFloat.greatestFiniteMagnitude
      for (i, r) in rects.enumerated() {
        let rad = radii[i]
        let qx = abs(x - r.midX) - r.width / 2 + rad
        let qy = abs(y - r.midY) - r.height / 2 + rad
        let outside = (max(qx, 0) * max(qx, 0) + max(qy, 0) * max(qy, 0)).squareRoot()
        let di = outside + min(max(qx, qy), 0) - rad
        if d == .greatestFiniteMagnitude {
          d = di
        } else {
          // smooth min: the bridge between shapes closer than `spacing`
          let t = max(0, min(1, 0.5 + 0.5 * (di - d) / k))
          d = di + (d - di) * t - k * t * (1 - t)
        }
      }
      return d
    }

    let area = rects.dropFirst().reduce(rects[0]) { $0.union($1) }.insetBy(dx: -k - step, dy: -k - step)
    let x0 = max(0, Int(area.minX / step))
    let x1 = min(w, Int((area.maxX / step).rounded(.up)))
    let y0 = max(0, Int(area.minY / step))
    let y1 = min(h, Int((area.maxY / step).rounded(.up)))
    guard x0 < x1, y0 < y1 else { return }

    for y in y0..<y1 {
      for x in x0..<x1 {
        let px = (CGFloat(x) + 0.5) * step
        let py = (CGFloat(y) + 0.5) * step
        let d = field(px, py)
        if d > step { continue }
        alphaBuffer[y * w + x] = UInt8(max(0, min(1, 0.5 - d / step)) * 255)
        // rim light, brightest facing top-left
        if d > -3 {
          let gx = field(px + 1, py) - field(px - 1, py)
          let gy = field(px, py + 1) - field(px, py - 1)
          let len = max((gx * gx + gy * gy).squareRoot(), 0.0001)
          let facing = max(0, -(gx / len) * 0.64 - (gy / len) * 0.77)
          let band = max(0, 1 - abs(d + 1) / 2)
          let v = UInt8(max(0, min(1, band * (0.25 + 0.7 * facing) * (dark ? 0.6 : 0.9))) * 255)
          let o = (y * w + x) * 4
          lightBuffer[o] = v
          lightBuffer[o + 1] = v
          lightBuffer[o + 2] = v
          lightBuffer[o + 3] = v
        }
      }
    }

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    shapeMask.frame = bounds
    rim.frame = bounds
    shapeMask.contents = Self.image(alphaBuffer, w, h, gray: true)
    rim.contents = Self.image(lightBuffer, w, h, gray: false)
    CATransaction.commit()
  }

  private static func image(_ bytes: [UInt8], _ w: Int, _ h: Int, gray: Bool) -> CGImage? {
    let data = Data(bytes) as CFData
    guard let provider = CGDataProvider(data: data) else { return nil }
    if gray {
      // mask layers only read alpha
      return CGImage(
        width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: w,
        space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.alphaOnly.rawValue),
        provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    }
    return CGImage(
      width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
      provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
  }
}

private final class GroupLinkProxy: NSObject {
  weak var group: GlassGroupView?
  init(_ group: GlassGroupView) { self.group = group }
  @objc func tick(_ l: CADisplayLink) {
    if let group { group.tick() } else { l.invalidate() }
  }
}
