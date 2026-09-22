import UIKit

/// Tint, sheen, hairline border and specular highlight, drawn over the blur or on their own.
/// Layers are built once, the border path only on size or radius changes.
final class AcrylicRenderer {
  enum Mode {
    case system, liveBlur, acrylic, opaque
  }

  struct Style: Equatable {
    var mode: Mode
    var dark: Bool
    var tint: UIColor?
    var intensity: CGFloat
    var minimal: Bool
    // 0 frosted to 1 clear
    var clarity: CGFloat = 0
  }

  let root = CALayer()
  private let fill = CALayer()
  private let sheen = CAGradientLayer()
  private let border = CAGradientLayer()
  // a bordered layer, not a stroked path: a UIBezierPath rounded rect curves differently from the
  // continuous clip and shows as a second edge inside the glass
  private let borderMask = CALayer()
  private let specular = CAGradientLayer()
  private var laidOutSize = CGSize.zero
  private var laidOutRadius: CGFloat = -1
  private var style: Style?

  init() {
    root.masksToBounds = true
    if #available(iOS 13.0, *) { root.cornerCurve = .continuous }
    sheen.startPoint = CGPoint(x: 0.5, y: 0)
    sheen.endPoint = CGPoint(x: 0.5, y: 0.6)
    // lit from the top-left, same as the Android shader
    border.startPoint = CGPoint(x: 0, y: 0)
    border.endPoint = CGPoint(x: 1, y: 1)
    borderMask.borderColor = UIColor.black.cgColor
    if #available(iOS 13.0, *) { borderMask.cornerCurve = .continuous }
    border.mask = borderMask
    specular.type = .radial
    specular.startPoint = CGPoint(x: 0.5, y: 0.5)
    specular.endPoint = CGPoint(x: 1, y: 1)
    specular.opacity = 0
    [fill, sheen, border, specular].forEach(root.addSublayer)
  }

  func layout(bounds: CGRect, radius: CGFloat, scale: CGFloat) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    root.frame = bounds
    root.cornerRadius = radius
    fill.frame = bounds
    sheen.frame = bounds
    border.frame = bounds
    if bounds.size != laidOutSize || radius != laidOutRadius {
      laidOutSize = bounds.size
      laidOutRadius = radius
      let width = max(1 / scale, 0.75)
      borderMask.frame = bounds
      borderMask.borderWidth = width
      borderMask.cornerRadius = radius
      let d = max(bounds.width, bounds.height) * 0.9
      specular.bounds = CGRect(x: 0, y: 0, width: d, height: d)
    }
    CATransaction.commit()
  }

  func apply(_ next: Style, animated: Bool) {
    guard next != style else { return }
    style = next
    CATransaction.begin()
    CATransaction.setDisableActions(!animated)
    CATransaction.setAnimationDuration(0.3)

    let i = next.intensity
    let neutral = next.dark ? UIColor(white: 0.12, alpha: 1) : UIColor(white: 0.97, alpha: 1)
    let base = next.tint ?? neutral
    let fillAlpha: CGFloat
    switch next.mode {
    case .system: fillAlpha = 0  // UIGlassEffect carries the tint itself
    // neutral frost clears with clarity. A colour tint gets stronger instead, or the frost and a
    // sharper background wash it out
    case .liveBlur:
      fillAlpha =
        next.tint == nil
        ? ((next.dark ? 0.12 : 0.08) + 0.22 * i) * (1 - 0.6 * next.clarity)
        : (0.25 + 0.35 * i) * (1 + 0.4 * next.clarity)
    // no blur under acrylic, so it only clears so far before text behind gets hard to read past
    case .acrylic: fillAlpha = 0.62 + 0.28 * i - (next.tint == nil ? 0.3 * next.clarity : 0)
    case .opaque: fillAlpha = 0.97
    }
    fill.backgroundColor = base.withAlphaComponent(fillAlpha).cgColor

    // highlights lean toward the tint instead of pure white
    let light = Self.highlight(tint: next.tint, dark: next.dark)
    let showDecor = next.mode != .system && !next.minimal
    // highlights stay at any clarity, they're what still reads as glass when clear
    let sheenAlpha: CGFloat = showDecor ? (next.dark ? 0.1 : 0.2) * (0.5 + max(i, 0.5)) : 0
    sheen.colors = [light.withAlphaComponent(sheenAlpha).cgColor, light.withAlphaComponent(0).cgColor]

    // lit top-left only, a full rim reads as a white border on clear glass
    if next.mode == .opaque {
      border.colors = [light.withAlphaComponent(0.9).cgColor, light.withAlphaComponent(0.5).cgColor]
      border.locations = nil
    } else {
      let top: CGFloat = next.dark ? 0.6 : 0.5
      border.colors = [
        light.withAlphaComponent(top).cgColor, light.withAlphaComponent(0).cgColor,
        light.withAlphaComponent(0).cgColor,
      ]
      border.locations = [0, 0.45, 1]
    }
    border.opacity = next.mode == .system ? 0 : (next.minimal ? 0.6 : 1)

    specular.colors = [
      light.withAlphaComponent(next.dark ? 0.32 : 0.55).cgColor,
      light.withAlphaComponent(0).cgColor,
    ]
    CATransaction.commit()
  }

  func setHighlight(at point: CGPoint?, visible: Bool) {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if let point { specular.position = point }
    CATransaction.commit()
    // opacity keeps its implicit fade
    specular.opacity = visible ? 1 : 0
  }

  private static func highlight(tint: UIColor?, dark: Bool) -> UIColor {
    guard let tint else { return .white }
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    guard tint.getRed(&r, green: &g, blue: &b, alpha: &a) else { return .white }
    let k: CGFloat = dark ? 0.6 : 0.75
    return UIColor(red: r + (1 - r) * k, green: g + (1 - g) * k, blue: b + (1 - b) * k, alpha: 1)
  }
}
