/**
 * 漂浮守岸蓝光点：24 个 span.motep，轨迹/尺寸/延迟全部由内联 CSS 变量驱动，
 * 动画与 keyframes（float-a / float-b / float-c）在 chat.css / home.css 里。
 * 纯 CSS，零 JS、零依赖；pointer-events 由 .motes 关掉。
 * 全守岸蓝色系；约半数带外发光（glow），做出「深海浮游微光」的层次。
 */

interface Mote {
  track: 'a' | 'b' | 'c'
  x: string
  y: string
  s: string
  d: string
  delay: string
  o: string
  /** 守岸蓝色阶 */
  c: string
  glow?: boolean
}

const MOTES: Mote[] = [
  { track: 'a', x: '5%', y: '18%', s: '6px', d: '20s', delay: '0s', o: '.62', c: '#4A9CFF', glow: true },
  { track: 'b', x: '13%', y: '58%', s: '4px', d: '26s', delay: '2.2s', o: '.5', c: '#A5CEEF' },
  { track: 'c', x: '22%', y: '12%', s: '5px', d: '23s', delay: '5.4s', o: '.56', c: '#8AB8E8', glow: true },
  { track: 'a', x: '31%', y: '74%', s: '7px', d: '27s', delay: '1.4s', o: '.66', c: '#4A9CFF', glow: true },
  { track: 'b', x: '39%', y: '30%', s: '4px', d: '19s', delay: '7.6s', o: '.46', c: '#5B9BD5' },
  { track: 'c', x: '46%', y: '84%', s: '5px', d: '25s', delay: '3.6s', o: '.54', c: '#A5CEEF', glow: true },
  { track: 'a', x: '53%', y: '9%', s: '6px', d: '21s', delay: '10.2s', o: '.58', c: '#8AB8E8', glow: true },
  { track: 'b', x: '60%', y: '46%', s: '3px', d: '28s', delay: '2.9s', o: '.44', c: '#7FB2E8' },
  { track: 'c', x: '67%', y: '66%', s: '5px', d: '24s', delay: '12.8s', o: '.52', c: '#4A9CFF' },
  { track: 'a', x: '74%', y: '16%', s: '6px', d: '22s', delay: '4.8s', o: '.6', c: '#5B9BD5', glow: true },
  { track: 'b', x: '82%', y: '52%', s: '4px', d: '26s', delay: '8.9s', o: '.48', c: '#A5CEEF' },
  { track: 'c', x: '90%', y: '26%', s: '5px', d: '20s', delay: '14.6s', o: '.55', c: '#8AB8E8', glow: true },
  { track: 'a', x: '11%', y: '88%', s: '4px', d: '23s', delay: '11.5s', o: '.44', c: '#4A9CFF' },
  { track: 'b', x: '26%', y: '92%', s: '6px', d: '21s', delay: '6.3s', o: '.58', c: '#7FB2E8', glow: true },
  { track: 'c', x: '35%', y: '44%', s: '4px', d: '27s', delay: '1.9s', o: '.42', c: '#5B9BD5' },
  { track: 'a', x: '44%', y: '58%', s: '5px', d: '24s', delay: '13.4s', o: '.5', c: '#A5CEEF' },
  { track: 'b', x: '57%', y: '6%', s: '4px', d: '22s', delay: '9.7s', o: '.46', c: '#4A9CFF' },
  { track: 'c', x: '63%', y: '88%', s: '6px', d: '26s', delay: '5.8s', o: '.6', c: '#8AB8E8', glow: true },
  { track: 'a', x: '70%', y: '36%', s: '4px', d: '19s', delay: '15.2s', o: '.42', c: '#5B9BD5' },
  { track: 'b', x: '78%', y: '74%', s: '5px', d: '25s', delay: '7.1s', o: '.52', c: '#A5CEEF', glow: true },
  { track: 'c', x: '86%', y: '10%', s: '4px', d: '23s', delay: '2.6s', o: '.44', c: '#7FB2E8' },
  { track: 'a', x: '95%', y: '62%', s: '6px', d: '21s', delay: '12.1s', o: '.58', c: '#4A9CFF', glow: true },
  { track: 'b', x: '18%', y: '36%', s: '5px', d: '28s', delay: '4.2s', o: '.5', c: '#8AB8E8' },
  { track: 'c', x: '49%', y: '20%', s: '4px', d: '20s', delay: '16.4s', o: '.44', c: '#5B9BD5' }
]

export default function Motes() {
  return (
    <div className="motes" aria-hidden="true">
      {MOTES.map((m, i) => (
        <span
          key={i}
          className={'motep' + (m.track === 'a' ? '' : ' ' + m.track) + (m.glow ? ' glow' : '')}
          style={
            {
              '--x': m.x,
              '--y': m.y,
              '--s': m.s,
              '--d': m.d,
              '--delay': m.delay,
              '--o': m.o,
              '--c': m.c
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
