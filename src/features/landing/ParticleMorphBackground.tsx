import { useEffect, useRef, useState } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  OrthographicCamera,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from 'three'

const modelProfiles = {
  desktop: {
    pointCount: 56000,
    files: [
      new URL('./models/1111.pcloud.bin', import.meta.url).href,
      new URL('./models/2222.pcloud.bin', import.meta.url).href,
      new URL('./models/3333.pcloud.bin', import.meta.url).href,
    ],
  },
  mobile: {
    pointCount: 36000,
    files: [
      new URL('./models/1111-mobile.pcloud.bin', import.meta.url).href,
      new URL('./models/2222-mobile.pcloud.bin', import.meta.url).href,
      new URL('./models/3333-mobile.pcloud.bin', import.meta.url).href,
    ],
  },
} as const
const MODEL_SCALE = 1.25

const vertexShader = `
  uniform float uProgress;
  uniform float uIntro;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec2 uPointer;
  uniform float uPointerStrength;
  attribute vec3 aShape1;
  attribute vec3 aShape2;
  attribute vec3 aScatter;
  attribute float aSeed;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vPointerGlow;

  mat2 rotate2d(float angle) {
    float s = sin(angle);
    float c = cos(angle);
    return mat2(c, -s, s, c);
  }

  void main() {
    float progress = clamp(uProgress, 0.0, 2.0);
    float segment = min(floor(progress), 1.0);
    float localProgress = progress - segment;
    float eased = localProgress * localProgress * (3.0 - 2.0 * localProgress);
    vec3 shape0 = position * ${MODEL_SCALE.toFixed(2)};
    vec3 shape1 = aShape1 * ${MODEL_SCALE.toFixed(2)};
    vec3 shape2 = aShape2 * ${MODEL_SCALE.toFixed(2)};
    vec3 fromShape = mix(shape0, shape1, segment);
    vec3 toShape = mix(shape1, shape2, segment);
    vec3 modelPosition = mix(fromShape, toShape, eased);

    float disperse = sin(localProgress * 3.14159265);
    vec3 scatter = aScatter * (0.72 + aSeed * 1.65) * disperse;
    scatter.xz = rotate2d(uTime * 0.08 + aSeed * 2.4 * disperse) * scatter.xz;
    modelPosition += scatter;
    modelPosition.y += sin(uTime * 0.5 + aSeed * 18.0) * 0.018 * (0.25 + disperse);

    float intro = clamp(uIntro, 0.0, 1.0);
    intro = intro * intro * (3.0 - 2.0 * intro);
    vec2 edgeSign = vec2(aScatter.x < 0.0 ? -1.0 : 1.0, aScatter.y < 0.0 ? -1.0 : 1.0);
    vec3 introPosition = vec3(
      edgeSign.x * (2.0 + aSeed * 0.72),
      edgeSign.y * (1.16 + (1.0 - aSeed) * 0.34),
      aScatter.z * 1.15
    );
    introPosition.xy += normalize(aScatter.xy + vec2(0.0001)) * (0.18 + aSeed * 0.24);
    introPosition.xz = rotate2d(uTime * 0.08 + aSeed * 0.7) * introPosition.xz;
    modelPosition = mix(introPosition, modelPosition, intro);

    vec2 pointerDelta = modelPosition.xy - uPointer;
    float pointerDistance = length(pointerDelta);
    float pointerForce = smoothstep(1.05, 0.0, pointerDistance) * uPointerStrength;
    vec2 tangent = vec2(-pointerDelta.y, pointerDelta.x);
    tangent = normalize(tangent + vec2(0.0001));
    modelPosition.xy += tangent * pointerForce * (0.035 + aSeed * 0.045);
    modelPosition.xy += vec2(
      sin(uTime * 2.1 + aSeed * 18.0),
      cos(uTime * 1.8 + aSeed * 15.0)
    ) * pointerForce * 0.018;
    modelPosition.z += pointerForce * (0.06 + aSeed * 0.035);
    vPointerGlow = pointerForce;

    vec4 viewPosition = modelViewMatrix * vec4(modelPosition, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    gl_PointSize = mix(1.75 + aSeed * 0.72, 1.26 + aSeed * 1.36 + disperse * 0.72 + pointerForce * 0.54, intro) * uPixelRatio;

    vec3 color0 = vec3(0.22, 0.98, 0.88);
    vec3 color1 = vec3(1.0, 0.36, 0.66);
    vec3 color2 = vec3(1.0, 0.82, 0.34);
    vec3 fromColor = mix(color0, color1, segment);
    vec3 toColor = mix(color1, color2, segment);
    vec3 shapeColor = mix(fromColor, toColor, eased);
    vColor = mix(vec3(1.0, 0.94, 0.38), mix(shapeColor, vec3(1.0), disperse * 0.22 + aSeed * 0.05 + pointerForce * 0.22), intro);
    float depth = 1.0 - smoothstep(3.2, 5.65, -viewPosition.z);
    vAlpha = mix(1.18, 0.92 + disperse * 0.12 + pointerForce * 0.08, intro) * mix(0.42, 1.0, depth);
  }
`

const fragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vPointerGlow;

  void main() {
    float distanceToCenter = distance(gl_PointCoord, vec2(0.5));
    float alpha = 1.0 - smoothstep(0.12, 0.46, distanceToCenter);
    if (alpha < 0.01) discard;
    float glow = 1.0 + vPointerGlow * 0.2;
    gl_FragColor = vec4(vColor * glow, alpha * vAlpha);
  }
`

const createRandomAttributes = (count: number) => {
  const scatter = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  let value = 0x48434149
  const random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    return value / 4294967296
  }

  for (let i = 0; i < count; i += 1) {
    const theta = random() * Math.PI * 2
    const z = random() * 2 - 1
    const radius = Math.sqrt(1 - z * z)
    scatter[i * 3] = Math.cos(theta) * radius
    scatter[i * 3 + 1] = z
    scatter[i * 3 + 2] = Math.sin(theta) * radius
    seeds[i] = random()
  }
  return { scatter, seeds }
}

const scrollToMorphProgress = (scrollProgress: number) => {
  if (scrollProgress <= 0.2) return 0
  if (scrollProgress < 0.38) return (scrollProgress - 0.2) / 0.18
  if (scrollProgress <= 0.58) return 1
  if (scrollProgress < 0.76) return 1 + (scrollProgress - 0.58) / 0.18
  return 2
}

type ParticleMorphBackgroundProps = {
  started?: boolean
}

export function ParticleMorphBackground({ started = false }: ParticleMorphBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const startedRef = useRef(started)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [activeModel, setActiveModel] = useState(0)
  const [renderVersion, setRenderVersion] = useState(0)

  useEffect(() => {
    startedRef.current = started
  }, [started])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let disposed = false
    let animationFrame = 0
    let renderer: WebGLRenderer | null = null
    let geometry: BufferGeometry | null = null
    let material: ShaderMaterial | null = null
    let removeListeners = () => {}

    const start = async () => {
      try {
        setLoadState('loading')
        const modelProfile = window.innerWidth > 820 ? modelProfiles.desktop : modelProfiles.mobile
        const { files: modelFiles, pointCount } = modelProfile
        const loadModel = async (file: string) => {
          const response = await fetch(file)
          if (!response.ok) throw new Error(`Could not load ${file}`)
          const buffer = await response.arrayBuffer()
          const points = new Int16Array(buffer)
          if (points.length !== pointCount * 3) throw new Error(`Unexpected point count in ${file}`)
          return points
        }
        const initialPoints = await loadModel(modelFiles[0])
        if (disposed) return

        const scene = new Scene()
        const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
        camera.position.z = 4.8
        camera.lookAt(0, 0, 0)
        renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' })
        renderer.setClearColor(0x000000, 0)

        const randomAttributes = createRandomAttributes(pointCount)
        geometry = new BufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(initialPoints, 3, true))
        geometry.setAttribute('aShape1', new BufferAttribute(initialPoints, 3, true))
        geometry.setAttribute('aShape2', new BufferAttribute(initialPoints, 3, true))
        geometry.setAttribute('aScatter', new BufferAttribute(randomAttributes.scatter, 3))
        geometry.setAttribute('aSeed', new BufferAttribute(randomAttributes.seeds, 1))

        material = new ShaderMaterial({
          vertexShader,
          fragmentShader,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
          uniforms: {
            uProgress: { value: 0 },
            uIntro: { value: 0 },
            uTime: { value: 0 },
            uPixelRatio: { value: 1 },
            uPointer: { value: new Vector2(99, 99) },
            uPointerStrength: { value: 0 },
          },
        })

        const particles = new Points(geometry, material)
        scene.add(particles)
        canvas.dataset.morphState = 'loading'
        void Promise.all([loadModel(modelFiles[1]), loadModel(modelFiles[2])]).then(([shape1, shape2]) => {
          if (disposed || !geometry) return
          geometry.setAttribute('aShape1', new BufferAttribute(shape1, 3, true))
          geometry.setAttribute('aShape2', new BufferAttribute(shape2, 3, true))
          canvas.dataset.morphState = 'ready'
        }).catch((error) => {
          console.info('[particle-morph-background]', error)
          if (!disposed) canvas.dataset.morphState = 'fallback'
        })
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        let currentAspect = 1
        let currentViewHeight = 3.35
        let auditedCanvasSize = ''
        let nextPixelAuditAt = 1

        const resize = () => {
          if (!renderer || !material) return
          const width = window.innerWidth
          const height = window.innerHeight
          const pixelRatio = Math.min(window.devicePixelRatio, 1.5)
          renderer.setPixelRatio(pixelRatio)
          renderer.setSize(width, height, false)
          const aspect = width / Math.max(height, 1)
          const viewHeight = width > 820 ? 3.35 : 4.7
          currentAspect = aspect
          currentViewHeight = viewHeight
          camera.left = -viewHeight * aspect / 2
          camera.right = viewHeight * aspect / 2
          camera.top = viewHeight / 2
          camera.bottom = -viewHeight / 2
          camera.updateProjectionMatrix()
          material.uniforms.uPixelRatio.value = pixelRatio
          geometry?.setDrawRange(0, width > 820 ? pointCount : Math.min(pointCount, modelProfiles.mobile.pointCount))
          particles.position.x = 0
          particles.position.y = width > 820 ? -0.02 : -0.1
          particles.scale.setScalar(width > 820 ? 1.02 : 0.72)
          auditedCanvasSize = ''
          nextPixelAuditAt = 0
          canvas.dataset.renderState = 'checking'
          delete canvas.dataset.coloredPixels
        }

        let targetProgress = 0
        let currentProgress = 0
        let lastActiveModel = -1
        const pointerTarget = new Vector2(99, 99)
        const pointerCurrent = new Vector2(99, 99)
        let pointerStrengthTarget = 0
        let pointerStrength = 0
        let pointerTiltX = 0
        let pointerTiltY = 0
        let currentIntro = 0
        const updateScroll = () => {
          const available = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
          const scrollProgress = Math.min(1, Math.max(0, window.scrollY / available))
          targetProgress = startedRef.current ? scrollToMorphProgress(scrollProgress) : 0
          const nextActiveModel = Math.min(2, Math.max(0, Math.round(targetProgress)))
          if (nextActiveModel !== lastActiveModel) {
            lastActiveModel = nextActiveModel
            setActiveModel(nextActiveModel)
          }
        }

        const updatePointer = (event: PointerEvent) => {
          const normalizedX = event.clientX / window.innerWidth * 2 - 1
          const normalizedY = -(event.clientY / window.innerHeight * 2 - 1)
          const pointerX = normalizedX * currentViewHeight * currentAspect / 2 - particles.position.x
          const pointerY = normalizedY * currentViewHeight / 2 - particles.position.y
          pointerTarget.set(
            pointerX,
            pointerY,
          )
          if (pointerStrengthTarget === 0) pointerCurrent.set(pointerX, pointerY)
          pointerStrengthTarget = 1
          pointerTiltX = normalizedY * 0.075
          pointerTiltY = normalizedX * 0.11
        }

        const clearPointer = () => {
          pointerStrengthTarget = 0
          pointerTiltX = 0
          pointerTiltY = 0
        }

        const startTime = performance.now()
        const render = () => {
          if (disposed || !renderer || !material) return
          const elapsed = (performance.now() - startTime) / 1000
          updateScroll()
          const visualTargetProgress = startedRef.current ? targetProgress : 0
          const introTarget = startedRef.current && elapsed > 0.8 ? 1 : 0
          currentProgress = reduceMotion
            ? visualTargetProgress
            : currentProgress + (visualTargetProgress - currentProgress) * 0.075
          currentIntro = reduceMotion
            ? introTarget
            : currentIntro + (introTarget - currentIntro) * 0.075
          pointerCurrent.lerp(pointerTarget, 0.1)
          pointerStrength += (pointerStrengthTarget - pointerStrength) * 0.08
          material.uniforms.uProgress.value = currentProgress
          material.uniforms.uIntro.value = currentIntro
          material.uniforms.uTime.value = elapsed
          material.uniforms.uPointer.value.copy(pointerCurrent)
          material.uniforms.uPointerStrength.value = reduceMotion || !startedRef.current ? 0 : pointerStrength
          const autoRotationY = reduceMotion ? 0 : Math.sin(elapsed * 0.38) * 0.13 * currentIntro
          const autoRotationX = reduceMotion ? 0 : Math.sin(elapsed * 0.27) * 0.045 * currentIntro
          particles.rotation.x += (autoRotationX + pointerTiltX - particles.rotation.x) * 0.055
          particles.rotation.y += (autoRotationY + pointerTiltY - particles.rotation.y) * 0.055
          particles.rotation.z = reduceMotion ? 0 : Math.sin(elapsed * 0.23) * 0.018
          renderer.render(scene, camera)
          const canvasSize = `${canvas.width}x${canvas.height}`
          if (canvasSize !== auditedCanvasSize && elapsed >= nextPixelAuditAt && currentIntro > 0.12) {
            const gl = renderer.getContext()
            const sampleWidth = Math.min(canvas.width, 512)
            const sampleHeight = Math.min(canvas.height, 512)
            const pixels = new Uint8Array(sampleWidth * sampleHeight * 4)
            gl.readPixels(
              Math.max(0, Math.floor((canvas.width - sampleWidth) / 2)),
              Math.max(0, Math.floor((canvas.height - sampleHeight) / 2)),
              sampleWidth,
              sampleHeight,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              pixels,
            )
            let coloredPixels = 0
            for (let index = 3; index < pixels.length; index += 4) {
              if (pixels[index] > 0) coloredPixels += 1
            }
            canvas.dataset.coloredPixels = String(coloredPixels)
            canvas.dataset.renderState = coloredPixels > 100 ? 'nonblank' : 'checking'
            if (coloredPixels > 100) auditedCanvasSize = canvasSize
            nextPixelAuditAt = elapsed + 0.25
          }
          animationFrame = window.requestAnimationFrame(render)
        }

        resize()
        updateScroll()
        window.addEventListener('resize', resize)
        window.addEventListener('pointermove', updatePointer, { passive: true })
        document.documentElement.addEventListener('pointerleave', clearPointer)
        window.addEventListener('blur', clearPointer)
        const handleContextLost = (event: Event) => {
          event.preventDefault()
          window.cancelAnimationFrame(animationFrame)
          canvas.dataset.renderState = 'context-lost'
          setLoadState('error')
        }
        const handleContextRestored = () => {
          if (!disposed) setRenderVersion((version) => version + 1)
        }
        canvas.addEventListener('webglcontextlost', handleContextLost)
        canvas.addEventListener('webglcontextrestored', handleContextRestored)
        setLoadState('ready')
        render()

        removeListeners = () => {
          window.removeEventListener('resize', resize)
          window.removeEventListener('pointermove', updatePointer)
          document.documentElement.removeEventListener('pointerleave', clearPointer)
          window.removeEventListener('blur', clearPointer)
          canvas.removeEventListener('webglcontextlost', handleContextLost)
          canvas.removeEventListener('webglcontextrestored', handleContextRestored)
        }
      } catch (error) {
        console.error('[particle-morph-background]', error)
        if (!disposed) setLoadState('error')
      }
    }

    void start()
    return () => {
      disposed = true
      window.cancelAnimationFrame(animationFrame)
      removeListeners()
      geometry?.dispose()
      material?.dispose()
      renderer?.dispose()
    }
  }, [renderVersion])

  return (
    <div className={`hcai-particle-background is-${loadState}`} aria-hidden="true">
      <canvas ref={canvasRef} data-render-state="loading" />
      <div className="hcai-particle-status">
        <span>{loadState === 'loading' ? 'LOADING FORMS' : loadState === 'error' ? 'STATIC MODE' : `FORM 0${activeModel + 1}`}</span>
        <div>{[0, 1, 2].map((index) => <i className={index === activeModel ? 'active' : ''} key={index} />)}</div>
      </div>
    </div>
  )
}
