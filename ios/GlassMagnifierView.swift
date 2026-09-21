import ExpoModulesCore
import UIKit

/// Holding the content lifts a clear lens that follows the finger and magnifies what's under it.
/// Same approach as the tab bar lens: one capture per press, originals under the lens masked out.
final class GlassMagnifierView: ExpoView, UIGestureRecognizerDelegate {
  var lensWidth: CGFloat = 96
  var lensHeight: CGFloat = 64
  var magnification: CGFloat = 1.4
  var lift: CGFloat = 0
  var refraction = true
  var disabled = false

  private let contentView = UIView()
  private let contentMask = CAShapeLayer()
  private let lens = UIView()
  private let lensRim = CAGradientLayer()
  private let lensRimMask = CAShapeLayer()
  private var magnified: UIView?
  private var shader: LensShaderRenderer?
  private var usingShader = false
  private var pressing = false

  // finger x, finger y, press 0..1
  private lazy var springs = SpringDriver(count: 3) { [weak self] in self?.applyFrame() }

  private lazy var touch: UILongPressGestureRecognizer = {
    let r = UILongPressGestureRecognizer(target: self, action: #selector(handleTouch(_:)))
    // a short hold, so a scroll view around it still gets its swipes
    r.minimumPressDuration = 0.15
    r.delegate = self
    return r
  }()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = false
    contentMask.fillRule = .evenOdd
    if #available(iOS 13.0, *) { lens.layer.cornerCurve = .continuous }
    lens.isUserInteractionEnabled = false
    lens.clipsToBounds = true
    lens.isHidden = true
    lensRim.type = .conic
    lensRim.startPoint = CGPoint(x: 0.5, y: 0.5)
    lensRim.endPoint = CGPoint(x: 1, y: 0.5)
    lensRim.locations = [0, 0.125, 0.3, 0.45, 0.625, 0.8, 1]
    // transparent white, UIColor.clear is black and greys the fade
    let clear = UIColor(white: 1, alpha: 0).cgColor
    lensRim.colors = [
      clear, UIColor(white: 1, alpha: 0.7).cgColor, clear, clear, UIColor(white: 1, alpha: 0.95).cgColor, clear, clear,
    ]
    lensRimMask.fillColor = nil
    lensRimMask.strokeColor = UIColor.black.cgColor
    lensRimMask.lineWidth = 1.5
    lensRim.mask = lensRimMask
    lens.layer.addSublayer(lensRim)
    addSubview(contentView)
    addSubview(lens)
    addGestureRecognizer(touch)
  }

  override func mountChildComponentView(_ childComponentView: UIView, index: Int) {
    contentView.insertSubview(childComponentView, at: index)
  }

  override func unmountChildComponentView(_ childComponentView: UIView, index: Int) {
    childComponentView.removeFromSuperview()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    if contentView.frame != bounds { contentView.frame = bounds }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      springs.stop()
      springs.snap(2, 0)
      applyFrame()
    }
  }

  func propsDidUpdate() {
    touch.isEnabled = !disabled
  }

  private func lensRect() -> CGRect {
    let v = springs.value
    let press = v[2]
    // grows out of the finger, `lift` floats it above
    let k = 0.4 + 0.6 * press
    let w = lensWidth * k
    let h = lensHeight * k
    return CGRect(x: v[0] - w / 2, y: v[1] - lift * press - h / 2, width: w, height: h)
  }

  private func applyFrame() {
    let press = springs.value[2]
    let lensUp = press > 0.001 && magnified != nil

    CATransaction.begin()
    CATransaction.setDisableActions(true)
    lens.isHidden = !lensUp
    if lensUp {
      let rect = lensRect()
      let radius = min(rect.width, rect.height) / 2
      lens.frame = rect
      lens.layer.cornerRadius = radius
      lensRim.frame = lens.bounds
      lensRim.opacity = Float(press)
      lensRimMask.path = UIBezierPath(roundedRect: lens.bounds.insetBy(dx: 0.75, dy: 0.75), cornerRadius: radius).cgPath
      // at press 0 the copy sits exactly on the originals, so it never has to fade
      let m = 1 + (magnification - 1) * press
      if usingShader {
        updateShader(rect: rect, radius: radius, magnification: m, press: press)
      } else {
        placeMagnified(magnification: m)
      }
      let hole = UIBezierPath(rect: contentView.bounds)
      hole.append(UIBezierPath(roundedRect: rect, cornerRadius: radius))
      contentMask.frame = contentView.bounds
      contentMask.path = hole.cgPath
      if contentView.layer.mask == nil { contentView.layer.mask = contentMask }
    } else if contentView.layer.mask != nil {
      contentView.layer.mask = nil
    }
    CATransaction.commit()

    if !pressing && press <= 0.001 && magnified != nil && !springs.isRunning {
      magnified?.removeFromSuperview()
      magnified = nil
      if usingShader { shader?.release() }
      usingShader = false
    }
  }

  private var screenScale: CGFloat { window?.screen.scale ?? UIScreen.main.scale }

  private func updateShader(rect: CGRect, radius: CGFloat, magnification m: CGFloat, press: CGFloat) {
    guard let shader else { return }
    let scale = screenScale
    shader.view.frame = lens.bounds
    let drawable = CGSize(width: (rect.width * scale).rounded(), height: (rect.height * scale).rounded())
    if shader.view.drawableSize != drawable { shader.view.drawableSize = drawable }
    var u = shader.uniforms
    u.center = SIMD2(Float(springs.value[0] * scale), Float(springs.value[1] * scale))
    u.magnification = Float(m)
    u.radius = Float(radius * scale)
    u.bezel = Float(min(rect.width, rect.height) * 0.25 * scale)
    u.refraction = Float(5 * scale * press)
    u.chroma = 1
    u.press = Float(press)
    shader.uniforms = u
    shader.render()
  }

  /// keeps the point under the finger at the lens center, magnified
  private func placeMagnified(magnification m: CGFloat) {
    guard let copy = magnified else { return }
    copy.bounds = CGRect(origin: .zero, size: contentView.bounds.size)
    copy.transform = CGAffineTransform(scaleX: m, y: m)
    let lb = lens.bounds
    copy.center = CGPoint(
      x: lb.midX - (springs.value[0] - contentView.bounds.midX) * m,
      y: lb.midY - (springs.value[1] - contentView.bounds.midY) * m)
  }

  @objc private func handleTouch(_ r: UILongPressGestureRecognizer) {
    let p = r.location(in: self)
    let x = min(max(p.x, 0), bounds.width)
    let y = min(max(p.y, 0), bounds.height)
    switch r.state {
    case .began:
      pressing = true
      if magnified == nil {
        if refraction, let s = shader ?? LensShaderRenderer(frame: .zero), s.load(from: contentView, scale: screenScale) {
          shader = s
          lens.insertSubview(s.view, at: 0)
          magnified = s.view
          usingShader = true
        } else if let copy = contentView.snapshotView(afterScreenUpdates: false) {
          copy.isUserInteractionEnabled = false
          lens.insertSubview(copy, at: 0)
          magnified = copy
          usingShader = false
        }
      }
      if springs.value[2] <= 0.001 {
        springs.snap(0, x)
        springs.snap(1, y)
      }
      springs.target[0] = x
      springs.target[1] = y
      springs.target[2] = 1
      springs.stiffness = 700
      springs.damping = 1
      springs.start()
    case .changed:
      springs.target[0] = x
      springs.target[1] = y
      springs.start()
    default:
      pressing = false
      springs.target[2] = 0
      springs.stiffness = 420
      springs.damping = 1
      springs.start()
    }
  }
}
