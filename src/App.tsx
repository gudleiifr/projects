import './style.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L, { type Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'

type CarStatus = 'В поездке' | 'Свободен' | 'На зарядке' | 'Вне сервиса'
type FleetFilter = 'all' | 'trip' | 'free' | 'charge' | 'out' | 'alerts'
type Incident = { time: string; message: string; critical: boolean; icon: string }
type LogTemplate = Omit<Incident, 'time'>
type TripState = { routeIndex: number; segmentIndex: number; segmentProgress: number; speed: number }
type CarIndicatorKey = 'engine' | 'battery' | 'wheel' | 'temperature' | 'lidar'

type Car = {
  uid?: string
  id: string
  model: string
  charge: number
  status: CarStatus
  hasAlert?: boolean
  chargingIcon?: boolean
  logs?: Incident[]
  alertIndicators?: CarIndicatorKey[]
}

const fleet: Car[] = [
  {
    id: 'E103KK 96',
    model: 'Hyundai Sonata',
    charge: 62,
    status: 'В поездке',
    hasAlert: true,
    alertIndicators: ['temperature', 'lidar'],
  },
  { id: 'C205EP 77', model: 'Hyundai Sonata', charge: 96, status: 'В поездке' },
  { id: 'K989TB 96', model: 'Lada Granta', charge: 89, status: 'В поездке' },
  { id: 'P941PM 96', model: 'Москвич GTR', charge: 6, status: 'Свободен' },
  { id: 'H008OC 77', model: 'Lada Granta', charge: 59, status: 'На зарядке', chargingIcon: true },
  { id: 'T321MK 77', model: 'Peugeot Boxer', charge: 41, status: 'На зарядке', chargingIcon: true },
  {
    id: 'E004PP 77',
    model: 'Hyundai Sonata',
    charge: 0,
    status: 'Вне сервиса',
    hasAlert: true,
    alertIndicators: ['engine', 'battery', 'lidar'],
  },
  { id: 'E089AM 77', model: 'Peugeot Boxer', charge: 0, status: 'Вне сервиса' },
  { id: 'E103KK 96', model: 'Hyundai Sonata', charge: 100, status: 'Вне сервиса' },
  { id: 'E103KK 96', model: 'Hyundai Sonata', charge: 100, status: 'Вне сервиса' },
]

const extraFleet: Car[] = [
  { id: 'A120BC 77', model: 'Hyundai Sonata', charge: 78, status: 'В поездке' },
  { id: 'M450KT 78', model: 'Lada Granta', charge: 52, status: 'На зарядке', chargingIcon: true },
  { id: 'X901OP 98', model: 'Peugeot Boxer', charge: 34, status: 'На зарядке', chargingIcon: true },
  { id: 'Y313AA 97', model: 'Hyundai Sonata', charge: 87, status: 'В поездке' },
  { id: 'T777TT 77', model: 'Москвич GTR', charge: 12, status: 'Свободен' },
  { id: 'C100CC 78', model: 'Hyundai Sonata', charge: 64, status: 'В поездке' },
  { id: 'P009PP 77', model: 'Lada Granta', charge: 26, status: 'Свободен' },
  { id: 'B222BB 98', model: 'Peugeot Boxer', charge: 0, status: 'Вне сервиса' },
  { id: 'H707HH 97', model: 'Hyundai Sonata', charge: 91, status: 'В поездке' },
  { id: 'K404KK 78', model: 'Lada Granta', charge: 43, status: 'На зарядке', chargingIcon: true },
]

const defaultIncidentTemplates: LogTemplate[] = [
  { message: 'Ошибка системы охлаждения', critical: true, icon: '/engine.svg' },
  { message: 'Ошибка датчика лидара\n(Левый фронтальный)', critical: true, icon: '/lidar.svg' },
  { message: 'Резкое падение напряжения в блоке\nB-12', critical: true, icon: '/battery.svg' },
  { message: 'Температура процессора достигла 85°C', critical: true, icon: '/temperature.svg' },
  { message: 'Автоматическая остановка:\nпрепятствие на пути', critical: false, icon: '/wheel.svg' },
  { message: 'Начало поездки (Заказ №4512)', critical: false, icon: '/battery-charge-28-regular.svg' },
]

const logsByCarId: Record<string, LogTemplate[]> = {
  'E103KK 96': [
    { message: 'Ошибка системы охлаждения', critical: true, icon: '/engine.svg' },
    { message: 'Перегрузка на канале CAN-2', critical: true, icon: '/lidar.svg' },
    { message: 'Резкое торможение на Тверской', critical: false, icon: '/wheel.svg' },
    { message: 'Маршрут обновлен диспетчером', critical: false, icon: '/battery.svg' },
  ],
  'P941PM 96': [
    { message: 'Ожидание следующего заказа', critical: false, icon: '/wheel.svg' },
    { message: 'Связь стабильна', critical: false, icon: '/lidar.svg' },
    { message: 'Переход в режим свободен', critical: false, icon: '/battery.svg' },
  ],
  'H008OC 77': [
    { message: 'Подключено к зарядной станции #3', critical: false, icon: '/battery-charge-28-regular.svg' },
    { message: 'Оценка времени заряда: 22 мин', critical: false, icon: '/battery.svg' },
    { message: 'Скорость заряда: 120 кВт', critical: false, icon: '/engine.svg' },
  ],
  'E004PP 77': [
    { message: 'Авто выведено из сервиса', critical: true, icon: '/warning-line.svg' },
    { message: 'Потеря связи с модулем lidar', critical: true, icon: '/lidar.svg' },
    { message: 'Требуется осмотр инженера', critical: true, icon: '/engine.svg' },
  ],
}

const normalStatusTemplates: Array<{ message: string; icon: string }> = [
  { message: 'Начало поездки (заказ №4512)', icon: '/wheel.svg' },
  { message: 'Маршрут подтвержден диспетчером', icon: '/wheel.svg' },
  { message: 'Стабильный канал связи с центром мониторинга', icon: '/lidar.svg' },
  { message: 'Система автопилота в штатном режиме', icon: '/engine.svg' },
  { message: 'Текущий трафик учтен в ETA', icon: '/wheel.svg' },
  { message: 'Температура батареи в рабочем диапазоне', icon: '/temperature.svg' },
  { message: 'Рекуперация энергии активна', icon: '/battery.svg' },
  { message: 'Коррекция траектории выполнена успешно', icon: '/lidar.svg' },
  { message: 'Поиск следующего заказа запущен', icon: '/battery-charge-28-regular.svg' },
]

const statusColor: Record<CarStatus, string> = {
  'В поездке': '#4ca9ff',
  'Свободен': '#00ff48',
  'На зарядке': '#f79f2e',
  'Вне сервиса': 'rgba(255,255,255,0.2)',
}

const getStatusColor = (car: Car) =>
  car.status === 'В поездке' && car.hasAlert ? '#ff0000' : statusColor[car.status]

function formatLogClock(d: Date) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function shuffleLogTemplates<T extends LogTemplate>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = out[i]!
    out[i] = out[j]!
    out[j] = a
  }
  return out
}

function logTemplatesWithTimes(templates: LogTemplate[], now: Date): Incident[] {
  return templates.map((row, idx) => {
    const d = new Date(now.getTime())
    d.setMinutes(d.getMinutes() - idx)
    return { ...row, time: formatLogClock(d) }
  })
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

function formatLiveLogTime(minutesAgo: number, pulse: number) {
  void pulse
  const d = new Date()
  d.setMinutes(d.getMinutes() - minutesAgo)
  return formatLogClock(d)
}

const globalLogTemplates: Array<{ message: string; critical: boolean; icon: string }> = [
  { message: 'Перестроение маршрута из-за дорожных работ', critical: false, icon: '/wheel.svg' },
  { message: 'Потеря пакета телеметрии > 2с', critical: true, icon: '/lidar.svg' },
  { message: 'Рекуперация энергии активна', critical: false, icon: '/battery.svg' },
  { message: 'Ограничение мощности тягового инвертора', critical: true, icon: '/engine.svg' },
  { message: 'Автоматическая смена полосы завершена', critical: false, icon: '/wheel.svg' },
  { message: 'Калибровка лидар-модуля завершена', critical: false, icon: '/lidar.svg' },
  { message: 'Перегрев батарейного модуля B3', critical: true, icon: '/temperature.svg' },
  { message: 'Станция зарядки подтвердила сессию', critical: false, icon: '/battery-charge-28-regular.svg' },
  { message: 'Снижение точности GPS, переход на inertial fusion', critical: true, icon: '/warning-line.svg' },
  { message: 'Обновление HD-карты участка выполнено', critical: false, icon: '/lidar.svg' },
  { message: 'Низкое давление в контуре охлаждения', critical: true, icon: '/temperature.svg' },
  { message: 'Контроль сцепления: корректировка крутящего момента', critical: false, icon: '/engine.svg' },
  { message: 'Стабилизация BMS: балансировка ячеек', critical: false, icon: '/battery.svg' },
  { message: 'Детектировано аномальное препятствие на маршруте', critical: true, icon: '/warning-line.svg' },
  { message: 'Канал V2X восстановлен', critical: false, icon: '/lidar.svg' },
  { message: 'Система автопилота переведена в режим осторожного движения', critical: true, icon: '/engine.svg' },
]

function BatteryDots({ charge }: { charge: number }) {
  const active = Math.round(charge / 20)
  const activeColor = charge < 20 ? '#ff0000' : charge <= 60 ? '#ff8a00' : '#6c9f72'
  return (
    <div className="battery-dots" aria-label={`Заряд: ${charge}%`}>
      {Array.from({ length: 5 }).map((_, idx) => (
        <span
          key={idx}
          className={idx < active ? 'dot active' : 'dot'}
          style={idx < active ? { background: activeColor } : undefined}
        />
      ))}
    </div>
  )
}

function PreloaderPixelTaxi() {
  return (
    <svg
      className="preloader-pixel-taxi"
      viewBox="0 0 24 10"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <rect x="2" y="4" width="17" height="4" fill="#ffdd2d" />
      <rect x="4" y="2" width="11" height="3" fill="#ffdd2d" />
      <rect x="5" y="1" width="9" height="2" fill="#ffdd2d" />
      <rect x="6" y="0" width="7" height="1" fill="#ffdd2d" />
      <rect x="17" y="5" width="5" height="3" fill="#e6c628" />
      <rect x="5" y="3" width="4" height="2" fill="#2d4a6f" />
      <rect x="10" y="3" width="4" height="2" fill="#2d4a6f" />
      <rect x="4" y="7" width="4" height="3" fill="#1a1d21" />
      <rect x="14" y="7" width="4" height="3" fill="#1a1d21" />
      <rect x="7" y="1" width="2" height="1" fill="#ffffff" />
      <rect x="21" y="5" width="2" height="1" fill="#fff9d6" />
    </svg>
  )
}

function EngineIcon() {
  return (
    <svg viewBox="0 0 23 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M8.35698 13.9923H15.8451C16.86 13.9923 17.4674 13.4157 17.4674 12.4086V11.0093C17.4674 10.9709 17.4905 10.9555 17.5212 10.9555H18.4361C18.4745 10.9555 18.4899 10.9709 18.4899 11.0093V11.8705C18.4899 12.7392 19.0665 13.2697 20.0044 13.2697H20.6425C21.5728 13.2697 22.1494 12.7469 22.1494 11.8705V6.31962C22.1494 5.44318 21.5728 4.92038 20.6425 4.92038H20.0044C19.0665 4.92038 18.4899 5.45086 18.4899 6.31962V7.03464C18.4899 7.06534 18.4745 7.08844 18.4361 7.08844H17.5212C17.4905 7.08844 17.4674 7.06534 17.4674 7.03464V5.72763C17.4674 4.77431 16.8754 4.1977 15.8913 4.1977H15.284L13.9923 2.79078C13.6925 2.46019 13.385 2.32949 13.0082 2.32949H7.03464C6.65019 2.32949 6.34268 2.47557 6.04285 2.79078L4.75125 4.1977H3.90555C2.93685 4.1977 2.33718 4.77431 2.33718 5.72763V10.5788C2.33718 11.5398 2.92916 12.1165 3.90555 12.1165H6.0736L7.3729 13.5311C7.67272 13.854 7.9495 13.9923 8.35698 13.9923ZM8.51843 12.7546C8.36465 12.7546 8.31853 12.7315 8.21855 12.6315L6.61175 10.8786H3.91324C3.69798 10.8786 3.57497 10.7556 3.57497 10.525V5.78914C3.57497 5.5585 3.69798 5.43549 3.91324 5.43549H5.30479L6.89621 3.70567C6.99619 3.59034 7.04999 3.56728 7.18068 3.56728H12.8545C12.9929 3.56728 13.0544 3.59034 13.1467 3.70567L14.7458 5.43549H15.8836C16.0989 5.43549 16.2296 5.56619 16.2296 5.78914V7.99562C16.2296 8.2032 16.3526 8.32621 16.5525 8.32621H19.4124C19.6123 8.32621 19.7353 8.2032 19.7353 7.99562V6.37343C19.7353 6.23505 19.8276 6.15817 20.0198 6.15817H20.6348C20.8194 6.15817 20.9116 6.24273 20.9116 6.37343V11.8089C20.9116 11.9473 20.8194 12.0318 20.6348 12.0318H20.0198C19.8276 12.0318 19.7353 11.955 19.7353 11.8089V10.0407C19.7353 9.83309 19.6123 9.71008 19.4124 9.71008H16.5525C16.3526 9.71008 16.2296 9.83309 16.2296 10.0407V12.3625C16.2296 12.6162 16.0989 12.7546 15.8375 12.7546H8.51843ZM0.615048 11.2015C0.96101 11.2015 1.23778 10.9094 1.23778 10.5788V8.7798H2.87535V7.54203H1.23778V5.73532C1.23778 5.39704 0.953321 5.12028 0.615048 5.12028C0.276772 5.12028 0 5.40473 0 5.73532V10.5788C0 10.9171 0.28446 11.2015 0.615048 11.2015ZM9.99455 3.106H11.24V1.23778H13.6541C13.9923 1.23778 14.2691 0.945639 14.2691 0.615048C14.2691 0.276772 13.9923 0 13.6541 0H7.56506C7.2268 0 6.95007 0.28446 6.95007 0.622736C6.95007 0.96101 7.23447 1.23778 7.56506 1.23778H9.99455V3.106Z"
        fill="currentColor"
      />
    </svg>
  )
}

function BatteryIcon() {
  return (
    <svg viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3.00511 13.9848H16.1467C17.7419 13.9848 18.5319 13.2024 18.5319 11.6375V4.2919C18.5319 2.72707 17.7419 1.94465 16.1467 1.94465H15.0984V0.92675C15.0984 0.349429 14.7642 0 14.1793 0H11.9383C11.361 0 11.0268 0.349429 11.0268 0.92675V1.94465H8.13258V0.92675C8.13258 0.349429 7.79836 0 7.21347 0H4.97255C4.38764 0 4.06099 0.349429 4.06099 0.92675V1.94465H3.00511C1.41748 1.94465 0.619873 2.72707 0.619873 4.2919V11.6375C0.619873 13.2024 1.41748 13.9848 3.00511 13.9848ZM1.84288 11.5692V4.36027C1.84288 3.57026 2.26067 3.16766 3.0203 3.16766H16.1315C16.8835 3.16766 17.3089 3.57026 17.3089 4.36027V11.5692C17.3089 12.3592 16.8835 12.7618 16.1315 12.7618H3.0203C2.26067 12.7618 1.84288 12.3592 1.84288 11.5692Z" fill="currentColor" />
      <path d="M4.50158 8.52305H7.66924C7.9807 8.52305 8.22379 8.27997 8.22379 7.96857C8.22379 7.64951 7.9807 7.40643 7.66924 7.40643H4.50158C4.19013 7.40643 3.93945 7.64951 3.93945 7.96857C3.93945 8.27997 4.19013 8.52305 4.50158 8.52305ZM13.055 10.255C13.3665 10.255 13.6096 10.0119 13.6096 9.70047V8.52305H14.787C15.0984 8.52305 15.3491 8.27997 15.3491 7.96857C15.3491 7.64951 15.0984 7.40643 14.787 7.40643H13.6096V6.229C13.6096 5.91755 13.3665 5.66687 13.055 5.66687C12.7435 5.66687 12.4929 5.91755 12.4929 6.229V7.40643H11.3155C11.004 7.40643 10.7609 7.64951 10.7609 7.96857C10.7609 8.27997 11.004 8.52305 11.3155 8.52305H12.4929V9.70047C12.4929 10.0119 12.7435 10.255 13.055 10.255Z" fill="currentColor" />
    </svg>
  )
}

function WheelIcon() {
  return (
    <svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9.87778 13.5C11.493 13.5 12.8028 10.5899 12.8028 7C12.8028 3.41005 11.493 0.5 9.87778 0.5M6.95278 7C6.95278 10.5899 5.64303 13.5 4.02778 13.5C2.41253 13.5 1.10278 10.5899 1.10278 7C1.10278 3.41005 2.41253 0.5 4.02778 0.5C5.64303 0.5 6.95278 3.41005 6.95278 7Z" stroke="currentColor" strokeWidth="0.975" />
      <path d="M4.02771 13.5C5.64296 13.5 6.95271 10.5899 6.95271 7C6.95271 3.41005 5.64296 0.5 4.02771 0.5" stroke="currentColor" strokeWidth="0.975" />
      <path d="M4.02773 0.5H9.87773M4.02773 13.5H9.87773M5.00273 7C5.00273 9.1541 4.56593 10.9 4.02773 10.9C3.48953 10.9 3.05273 9.1541 3.05273 7C3.05273 4.8459 3.48953 3.1 4.02773 3.1C4.56593 3.1 5.00273 4.8459 5.00273 7Z" stroke="currentColor" strokeWidth="0.975" />
      <path d="M5.00278 7H4.35278" stroke="currentColor" strokeWidth="0.975" strokeLinecap="round" />
    </svg>
  )
}

function TemperatureIcon() {
  return (
    <svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M6.93728 1.61225C6.5806 1.61225 6.23854 1.75394 5.98633 2.00615C5.73412 2.25836 5.59244 2.60042 5.59244 2.9571V8.41071L5.41886 8.5703C5.08695 8.87591 4.85499 9.27458 4.75333 9.71416C4.65167 10.1537 4.68504 10.6138 4.84907 11.0341C5.0131 11.4544 5.30016 11.8154 5.6727 12.0699C6.04524 12.3244 6.48592 12.4606 6.9371 12.4606C7.38828 12.4606 7.82896 12.3244 8.2015 12.0699C8.57404 11.8154 8.8611 11.4544 9.02513 11.0341C9.18916 10.6138 9.22253 10.1537 9.12087 9.71416C9.01921 9.27458 8.78725 8.87591 8.45534 8.5703L8.28212 8.41071V2.9571C8.28212 2.60042 8.14044 2.25836 7.88823 2.00615C7.63602 1.75394 7.29395 1.61225 6.93728 1.61225ZM4.51656 2.9571C4.51656 2.31508 4.7716 1.69936 5.22557 1.24539C5.67955 0.791416 6.29526 0.536377 6.93728 0.536377C7.57929 0.536377 8.19501 0.791416 8.64899 1.24539C9.10296 1.69936 9.358 2.31508 9.358 2.9571V7.95095C9.80031 8.42302 10.0949 9.01412 10.2056 9.65149C10.3163 10.2889 10.2382 10.9447 9.981 11.5382C9.72375 12.1318 9.29856 12.6372 8.75777 12.9922C8.21698 13.3472 7.58419 13.5364 6.93728 13.5364C6.29037 13.5364 5.65758 13.3472 5.11679 12.9922C4.576 12.6372 4.15081 12.1318 3.89356 11.5382C3.63631 10.9447 3.55823 10.2889 3.66892 9.65149C3.77961 9.01412 4.07424 8.42302 4.51656 7.95095V2.9571ZM8.37178 10.2193C8.37166 10.4795 8.30074 10.7348 8.16662 10.9578C8.0325 11.1809 7.84024 11.3632 7.61042 11.4853C7.3806 11.6075 7.1219 11.6648 6.86201 11.6511C6.60212 11.6374 6.35084 11.5533 6.13509 11.4078C5.91934 11.2623 5.74724 11.0608 5.63723 10.8249C5.52723 10.5891 5.48346 10.3277 5.51061 10.0689C5.53776 9.81008 5.63481 9.56352 5.79137 9.35563C5.94792 9.14773 6.15809 8.98635 6.39934 8.88876V5.01919C6.39934 4.87652 6.45602 4.73969 6.5569 4.63881C6.65778 4.53793 6.79461 4.48125 6.93728 4.48125C7.07995 4.48125 7.21678 4.53793 7.31766 4.63881C7.41854 4.73969 7.47522 4.87652 7.47522 5.01919V8.88876C7.74022 8.99595 7.96715 9.17988 8.12689 9.41695C8.28664 9.65401 8.37192 9.93339 8.37178 10.2193Z" fill="currentColor" />
    </svg>
  )
}

function LidarIcon() {
  return (
    <svg viewBox="0 0 18 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M15.6121 6.99782H15.6199M1.61987 6.99782H1.62765M3.17456 9.32985H3.18234M3.17456 4.66578H3.18234M14.0574 9.32985H14.0652M8.61599 11.6619H8.62376M8.61599 2.33374H8.62376M5.5066 10.8845H5.51438M5.5066 3.11109H5.51438M11.7254 10.8845H11.7331M11.7254 3.11109H11.7331M14.0574 4.66578H14.0652M7.06129 6.99782C7.06129 7.41015 7.22509 7.80559 7.51665 8.09715C7.80821 8.38871 8.20366 8.55251 8.61599 8.55251C9.02832 8.55251 9.42376 8.38871 9.71532 8.09715C10.0069 7.80559 10.1707 7.41015 10.1707 6.99782C10.1707 6.58549 10.0069 6.19004 9.71532 5.89848C9.42376 5.60692 9.02832 5.44312 8.61599 5.44312C8.20366 5.44312 7.80821 5.60692 7.51665 5.89848C7.22509 6.19004 7.06129 6.58549 7.06129 6.99782Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ExportIcon() {
  return (
    <svg className="export-icon" viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M5.08079 4.49748L6.41663 3.15581V8.74998C6.41663 8.90469 6.47808 9.05306 6.58748 9.16246C6.69688 9.27185 6.84525 9.33331 6.99996 9.33331C7.15467 9.33331 7.30304 9.27185 7.41244 9.16246C7.52183 9.05306 7.58329 8.90469 7.58329 8.74998V3.15581L8.91913 4.49748C8.97335 4.55216 9.03787 4.59555 9.10896 4.62517C9.18004 4.65478 9.25629 4.67003 9.33329 4.67003C9.4103 4.67003 9.48654 4.65478 9.55763 4.62517C9.62871 4.59555 9.69323 4.55216 9.74746 4.49748C9.80213 4.44325 9.84553 4.37873 9.87515 4.30765C9.90476 4.23657 9.92001 4.16032 9.92001 4.08331C9.92001 4.00631 9.90476 3.93006 9.87515 3.85898C9.84553 3.78789 9.80213 3.72338 9.74746 3.66915L7.41413 1.33581C7.35865 1.28271 7.29323 1.24108 7.22163 1.21331C7.07961 1.15497 6.92031 1.15497 6.77829 1.21331C6.70669 1.24108 6.64127 1.28271 6.58579 1.33581L4.25246 3.66915C4.19807 3.72354 4.15493 3.78811 4.12549 3.85917C4.09606 3.93023 4.08091 4.0064 4.08091 4.08331C4.08091 4.16023 4.09606 4.2364 4.12549 4.30746C4.15493 4.37852 4.19807 4.44309 4.25246 4.49748C4.30685 4.55187 4.37142 4.59501 4.44248 4.62445C4.51354 4.65388 4.58971 4.66903 4.66663 4.66903C4.74354 4.66903 4.81971 4.65388 4.89077 4.62445C4.96183 4.59501 5.0264 4.55187 5.08079 4.49748ZM12.25 8.16665C12.0952 8.16665 11.9469 8.2281 11.8375 8.3375C11.7281 8.4469 11.6666 8.59527 11.6666 8.74998V11.0833C11.6666 11.238 11.6052 11.3864 11.4958 11.4958C11.3864 11.6052 11.238 11.6666 11.0833 11.6666H2.91663C2.76192 11.6666 2.61354 11.6052 2.50415 11.4958C2.39475 11.3864 2.33329 11.238 2.33329 11.0833V8.74998C2.33329 8.59527 2.27183 8.4469 2.16244 8.3375C2.05304 8.2281 1.90467 8.16665 1.74996 8.16665C1.59525 8.16665 1.44688 8.2281 1.33748 8.3375C1.22808 8.4469 1.16663 8.59527 1.16663 8.74998V11.0833C1.16663 11.5474 1.351 11.9926 1.67919 12.3208C2.00738 12.6489 2.4525 12.8333 2.91663 12.8333H11.0833C11.5474 12.8333 11.9925 12.6489 12.3207 12.3208C12.6489 11.9926 12.8333 11.5474 12.8333 11.0833V8.74998C12.8333 8.59527 12.7718 8.4469 12.6624 8.3375C12.553 8.2281 12.4047 8.16665 12.25 8.16665Z"
        fill="currentColor"
      />
    </svg>
  )
}

const ROAD_ROUTES: [number, number][][] = [
  [[55.7674, 37.6058], [55.7649, 37.6069], [55.7622, 37.6082], [55.7595, 37.6094], [55.7568, 37.6107]],
  [[55.7561, 37.5807], [55.7555, 37.5866], [55.7548, 37.5923], [55.7541, 37.5984]],
  [[55.7715, 37.6145], [55.7709, 37.6228], [55.7698, 37.6316], [55.7681, 37.6398]],
  [[55.7601, 37.6489], [55.7594, 37.6441], [55.7588, 37.6394], [55.7581, 37.6342]],
  [[55.7418, 37.6146], [55.7454, 37.6145], [55.7489, 37.6144], [55.7524, 37.6142]],
  [[55.7646, 37.6179], [55.7626, 37.6239], [55.7604, 37.6298], [55.7581, 37.6359]],
  [[55.7507, 37.6064], [55.7498, 37.6126], [55.7488, 37.6186], [55.7479, 37.6249]],
]

const hashUid = (uid: string) => uid.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
const normalizedHash = (uid: string) => (hashUid(uid) % 997) / 997
const indicatorOrder: CarIndicatorKey[] = ['engine', 'battery', 'wheel', 'temperature', 'lidar']
const indicatorLabels: Record<CarIndicatorKey, string> = {
  engine: 'Двигатель',
  battery: 'Батарея',
  wheel: 'Шасси и колеса',
  temperature: 'Температурный контур',
  lidar: 'Лидар и сенсоры',
}

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

const indicatorSvgMarkup = (key: CarIndicatorKey) => {
  if (key === 'engine') {
    return `<svg viewBox="0 0 23 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8.35698 13.9923H15.8451C16.86 13.9923 17.4674 13.4157 17.4674 12.4086V11.0093C17.4674 10.9709 17.4905 10.9555 17.5212 10.9555H18.4361C18.4745 10.9555 18.4899 10.9709 18.4899 11.0093V11.8705C18.4899 12.7392 19.0665 13.2697 20.0044 13.2697H20.6425C21.5728 13.2697 22.1494 12.7469 22.1494 11.8705V6.31962C22.1494 5.44318 21.5728 4.92038 20.6425 4.92038H20.0044C19.0665 4.92038 18.4899 5.45086 18.4899 6.31962V7.03464C18.4899 7.06534 18.4745 7.08844 18.4361 7.08844H17.5212C17.4905 7.08844 17.4674 7.06534 17.4674 7.03464V5.72763C17.4674 4.77431 16.8754 4.1977 15.8913 4.1977H15.284L13.9923 2.79078C13.6925 2.46019 13.385 2.32949 13.0082 2.32949H7.03464C6.65019 2.32949 6.34268 2.47557 6.04285 2.79078L4.75125 4.1977H3.90555C2.93685 4.1977 2.33718 4.77431 2.33718 5.72763V10.5788C2.33718 11.5398 2.92916 12.1165 3.90555 12.1165H6.0736L7.3729 13.5311C7.67272 13.854 7.9495 13.9923 8.35698 13.9923ZM8.51843 12.7546C8.36465 12.7546 8.31853 12.7315 8.21855 12.6315L6.61175 10.8786H3.91324C3.69798 10.8786 3.57497 10.7556 3.57497 10.525V5.78914C3.57497 5.5585 3.69798 5.43549 3.91324 5.43549H5.30479L6.89621 3.70567C6.99619 3.59034 7.04999 3.56728 7.18068 3.56728H12.8545C12.9929 3.56728 13.0544 3.59034 13.1467 3.70567L14.7458 5.43549H15.8836C16.0989 5.43549 16.2296 5.56619 16.2296 5.78914V7.99562C16.2296 8.2032 16.3526 8.32621 16.5525 8.32621H19.4124C19.6123 8.32621 19.7353 8.2032 19.7353 7.99562V6.37343C19.7353 6.23505 19.8276 6.15817 20.0198 6.15817H20.6348C20.8194 6.15817 20.9116 6.24273 20.9116 6.37343V11.8089C20.9116 11.9473 20.8194 12.0318 20.6348 12.0318H20.0198C19.8276 12.0318 19.7353 11.955 19.7353 11.8089V10.0407C19.7353 9.83309 19.6123 9.71008 19.4124 9.71008H16.5525C16.3526 9.71008 16.2296 9.83309 16.2296 10.0407V12.3625C16.2296 12.6162 16.0989 12.7546 15.8375 12.7546H8.51843ZM0.615048 11.2015C0.96101 11.2015 1.23778 10.9094 1.23778 10.5788V8.7798H2.87535V7.54203H1.23778V5.73532C1.23778 5.39704 0.953321 5.12028 0.615048 5.12028C0.276772 5.12028 0 5.40473 0 5.73532V10.5788C0 10.9171 0.28446 11.2015 0.615048 11.2015ZM9.99455 3.106H11.24V1.23778H13.6541C13.9923 1.23778 14.2691 0.945639 14.2691 0.615048C14.2691 0.276772 13.9923 0 13.6541 0H7.56506C7.2268 0 6.95007 0.28446 6.95007 0.622736C6.95007 0.96101 7.23447 1.23778 7.56506 1.23778H9.99455V3.106Z" fill="currentColor"/></svg>`
  }
  if (key === 'battery') {
    return `<svg viewBox="0 0 20 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3.00511 13.9848H16.1467C17.7419 13.9848 18.5319 13.2024 18.5319 11.6375V4.2919C18.5319 2.72707 17.7419 1.94465 16.1467 1.94465H15.0984V0.92675C15.0984 0.349429 14.7642 0 14.1793 0H11.9383C11.361 0 11.0268 0.349429 11.0268 0.92675V1.94465H8.13258V0.92675C8.13258 0.349429 7.79836 0 7.21347 0H4.97255C4.38764 0 4.06099 0.349429 4.06099 0.92675V1.94465H3.00511C1.41748 1.94465 0.619873 2.72707 0.619873 4.2919V11.6375C0.619873 13.2024 1.41748 13.9848 3.00511 13.9848ZM1.84288 11.5692V4.36027C1.84288 3.57026 2.26067 3.16766 3.0203 3.16766H16.1315C16.8835 3.16766 17.3089 3.57026 17.3089 4.36027V11.5692C17.3089 12.3592 16.8835 12.7618 16.1315 12.7618H3.0203C2.26067 12.7618 1.84288 12.3592 1.84288 11.5692Z" fill="currentColor"/><path d="M4.50158 8.52305H7.66924C7.9807 8.52305 8.22379 8.27997 8.22379 7.96857C8.22379 7.64951 7.9807 7.40643 7.66924 7.40643H4.50158C4.19013 7.40643 3.93945 7.64951 3.93945 7.96857C3.93945 8.27997 4.19013 8.52305 4.50158 8.52305ZM13.055 10.255C13.3665 10.255 13.6096 10.0119 13.6096 9.70047V8.52305H14.787C15.0984 8.52305 15.3491 8.27997 15.3491 7.96857C15.3491 7.64951 15.0984 7.40643 14.787 7.40643H13.6096V6.229C13.6096 5.91755 13.3665 5.66687 13.055 5.66687C12.7435 5.66687 12.4929 5.91755 12.4929 6.229V7.40643H11.3155C11.004 7.40643 10.7609 7.64951 10.7609 7.96857C10.7609 8.27997 11.004 8.52305 11.3155 8.52305H12.4929V9.70047C12.4929 10.0119 12.7435 10.255 13.055 10.255Z" fill="currentColor"/></svg>`
  }
  if (key === 'wheel') {
    return `<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M9.87778 13.5C11.493 13.5 12.8028 10.5899 12.8028 7C12.8028 3.41005 11.493 0.5 9.87778 0.5M6.95278 7C6.95278 10.5899 5.64303 13.5 4.02778 13.5C2.41253 13.5 1.10278 10.5899 1.10278 7C1.10278 3.41005 2.41253 0.5 4.02778 0.5C5.64303 0.5 6.95278 3.41005 6.95278 7Z" stroke="currentColor" stroke-width="0.975"/><path d="M4.02771 13.5C5.64296 13.5 6.95271 10.5899 6.95271 7C6.95271 3.41005 5.64296 0.5 4.02771 0.5" stroke="currentColor" stroke-width="0.975"/><path d="M4.02773 0.5H9.87773M4.02773 13.5H9.87773M5.00273 7C5.00273 9.1541 4.56593 10.9 4.02773 10.9C3.48953 10.9 3.05273 9.1541 3.05273 7C3.05273 4.8459 3.48953 3.1 4.02773 3.1C4.56593 3.1 5.00273 4.8459 5.00273 7Z" stroke="currentColor" stroke-width="0.975"/><path d="M5.00278 7H4.35278" stroke="currentColor" stroke-width="0.975" stroke-linecap="round"/></svg>`
  }
  if (key === 'temperature') {
    return `<svg viewBox="0 0 14 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6.93728 1.61225C6.5806 1.61225 6.23854 1.75394 5.98633 2.00615C5.73412 2.25836 5.59244 2.60042 5.59244 2.9571V8.41071L5.41886 8.5703C5.08695 8.87591 4.85499 9.27458 4.75333 9.71416C4.65167 10.1537 4.68504 10.6138 4.84907 11.0341C5.0131 11.4544 5.30016 11.8154 5.6727 12.0699C6.04524 12.3244 6.48592 12.4606 6.9371 12.4606C7.38828 12.4606 7.82896 12.3244 8.2015 12.0699C8.57404 11.8154 8.8611 11.4544 9.02513 11.0341C9.18916 10.6138 9.22253 10.1537 9.12087 9.71416C9.01921 9.27458 8.78725 8.87591 8.45534 8.5703L8.28212 8.41071V2.9571C8.28212 2.60042 8.14044 2.25836 7.88823 2.00615C7.63602 1.75394 7.29395 1.61225 6.93728 1.61225ZM4.51656 2.9571C4.51656 2.31508 4.7716 1.69936 5.22557 1.24539C5.67955 0.791416 6.29526 0.536377 6.93728 0.536377C7.57929 0.536377 8.19501 0.791416 8.64899 1.24539C9.10296 1.69936 9.358 2.31508 9.358 2.9571V7.95095C9.80031 8.42302 10.0949 9.01412 10.2056 9.65149C10.3163 10.2889 10.2382 10.9447 9.981 11.5382C9.72375 12.1318 9.29856 12.6372 8.75777 12.9922C8.21698 13.3472 7.58419 13.5364 6.93728 13.5364C6.29037 13.5364 5.65758 13.3472 5.11679 12.9922C4.576 12.6372 4.15081 12.1318 3.89356 11.5382C3.63631 10.9447 3.55823 10.2889 3.66892 9.65149C3.77961 9.01412 4.07424 8.42302 4.51656 7.95095V2.9571ZM8.37178 10.2193C8.37166 10.4795 8.30074 10.7348 8.16662 10.9578C8.0325 11.1809 7.84024 11.3632 7.61042 11.4853C7.3806 11.6075 7.1219 11.6648 6.86201 11.6511C6.60212 11.6374 6.35084 11.5533 6.13509 11.4078C5.91934 11.2623 5.74724 11.0608 5.63723 10.8249C5.52723 10.5891 5.48346 10.3277 5.51061 10.0689C5.53776 9.81008 5.63481 9.56352 5.79137 9.35563C5.94792 9.14773 6.15809 8.98635 6.39934 8.88876V5.01919C6.39934 4.87652 6.45602 4.73969 6.5569 4.63881C6.65778 4.53793 6.79461 4.48125 6.93728 4.48125C7.07995 4.48125 7.21678 4.53793 7.31766 4.63881C7.41854 4.73969 7.47522 4.87652 7.47522 5.01919V8.88876C7.74022 8.99595 7.96715 9.17988 8.12689 9.41695C8.28664 9.65401 8.37192 9.93339 8.37178 10.2193Z" fill="currentColor"/></svg>`
  }
  return `<svg viewBox="0 0 18 14" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M15.6121 6.99782H15.6199M1.61987 6.99782H1.62765M3.17456 9.32985H3.18234M3.17456 4.66578H3.18234M14.0574 9.32985H14.0652M8.61599 11.6619H8.62376M8.61599 2.33374H8.62376M5.5066 10.8845H5.51438M5.5066 3.11109H5.51438M11.7254 10.8845H11.7331M11.7254 3.11109H11.7331M14.0574 4.66578H14.0652M7.06129 6.99782C7.06129 7.41015 7.22509 7.80559 7.51665 8.09715C7.80821 8.38871 8.20366 8.55251 8.61599 8.55251C9.02832 8.55251 9.42376 8.38871 9.71532 8.09715C10.0069 7.80559 10.1707 7.41015 10.1707 6.99782C10.1707 6.58549 10.0069 6.19004 9.71532 5.89848C9.42376 5.60692 9.02832 5.44312 8.61599 5.44312C8.20366 5.44312 7.80821 5.60692 7.51665 5.89848C7.22509 6.19004 7.06129 6.58549 7.06129 6.99782Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

const buildTooltipHtml = (car: Car) => {
  const indicatorRow = indicatorOrder
    .map((key) => {
      const hot = Boolean(car.hasAlert && car.alertIndicators?.includes(key))
      return `<span class="tip-indicator-icon ${hot ? 'hot' : 'dim'}">${indicatorSvgMarkup(key)}</span>`
    })
    .join('')

  return `
    <div class="tip-wrap">
      <div class="tip-title">${escapeHtml(car.model)} • ${escapeHtml(car.id)}</div>
      <div class="tip-indicators">${indicatorRow}</div>
    </div>
  `
}

function MapLogoMark() {
  const [showHeart, setShowHeart] = useState(false)
  const heartTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (heartTimerRef.current !== null) window.clearTimeout(heartTimerRef.current)
    }
  }, [])

  const handleClick = () => {
    if (heartTimerRef.current !== null) window.clearTimeout(heartTimerRef.current)
    setShowHeart(true)
    heartTimerRef.current = window.setTimeout(() => {
      setShowHeart(false)
      heartTimerRef.current = null
    }, 1000)
  }

  return (
    <button
      type="button"
      className={`logo-mark-btn${showHeart ? ' logo-mark-btn--heart' : ''}`}
      onClick={handleClick}
      aria-label="Логотип"
    >
      <svg viewBox="0 0 71 24" xmlns="http://www.w3.org/2000/svg" className="logo-mark-svg" aria-hidden="true">
        <g className="logo-mark-text">
          <path
            d="M36.2298 14.0461H32.7765L32.1663 15.6299H29.0506L33.0232 6.54236H36.035L40.0076 15.6299H36.8399L36.2298 14.0461ZM35.3859 11.8391L34.5031 9.55423L33.6203 11.8391H35.3859Z"
            fill="#DDDDDD"
          />
          <path
            d="M47.8438 10.9563L50.5311 15.6299H47.0778L45.3382 12.3454H44.4814V15.6299H41.4176V6.54236H44.4814V9.93071H45.4161L47.3504 6.54236H50.5441L47.8438 10.9563Z"
            fill="#DDDDDD"
          />
          <path
            d="M56.3115 15.8376C55.3508 15.8376 54.4853 15.6386 53.7151 15.2404C52.9448 14.8337 52.339 14.2711 51.8976 13.5527C51.4648 12.8257 51.2484 12.0035 51.2484 11.0861C51.2484 10.1687 51.4648 9.35084 51.8976 8.63249C52.339 7.90549 52.9448 7.34293 53.7151 6.9448C54.4853 6.53803 55.3508 6.33464 56.3115 6.33464C57.1943 6.33464 57.9819 6.49043 58.6743 6.802C59.3667 7.11357 59.9379 7.56362 60.3879 8.15215L58.4536 9.87878C57.891 9.16909 57.2289 8.81424 56.4673 8.81424C55.8268 8.81424 55.3119 9.02196 54.9224 9.43739C54.5329 9.84416 54.3382 10.3937 54.3382 11.0861C54.3382 11.7785 54.5329 12.3324 54.9224 12.7479C55.3119 13.1546 55.8268 13.358 56.4673 13.358C57.2289 13.358 57.891 13.0032 58.4536 12.2935L60.3879 14.0201C59.9379 14.6086 59.3667 15.0587 58.6743 15.3703C57.9819 15.6818 57.1943 15.8376 56.3115 15.8376Z"
            fill="#DDDDDD"
          />
          <path
            d="M61.9627 6.54236H64.9746V11.2679L68.1033 6.54236H70.9854V15.6299H67.9735V10.9174L64.8578 15.6299H61.9627V6.54236Z"
            fill="#DDDDDD"
          />
        </g>
        <g className="logo-mark-shield">
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M24 0H21.3333V2.66667H18.6667L18.6667 5.31435H16V2.64769H18.6667L18.6667 0H16V2.66667H13.3333L13.3333 5.31435H10.6667L10.6667 2.66667H8L8 5.31435H5.33333V2.64769H8L8 0H5.33333V2.66667H2.66667V0H4.1999e-07L0 2.64769H2.66667V5.31435H0L4.1999e-07 12.0703C4.1999e-07 15.1646 1.65068 18.0239 4.33031 19.5712L12 24L19.6697 19.5712C22.3493 18.0239 24 15.1646 24 12.0703V0ZM10.6667 0L10.6667 2.64769H13.3333L13.3333 0H10.6667ZM24 2.64769H21.3333V5.31435H24V2.64769Z"
            fill="#DDDDDD"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M6.58679 6.35286V10.107C7.10015 9.52726 8.03353 9.13492 9.10072 9.13492H10.2605V13.499C10.2605 14.6601 9.945 15.6763 9.47693 16.2353H14.5216C14.0545 15.6758 13.7397 14.6608 13.7397 13.5012V9.13492H14.8995C15.9667 9.13492 16.9001 9.52726 17.4135 10.107V6.35286H6.58679Z"
            fill="#191919"
          />
        </g>
        <g className="logo-mark-heart">
          <path
            d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
            fill="#DDDDDD"
          />
        </g>
      </svg>
    </button>
  )
}

function App() {
  const fleetListRef = useRef<HTMLDivElement | null>(null)
  const globalLogListRef = useRef<HTMLDivElement | null>(null)
  const mapElementRef = useRef<HTMLDivElement | null>(null)
  const leafletMapRef = useRef<LeafletMap | null>(null)
  const movingMarkersRef = useRef<Array<{ uid: string; marker: L.CircleMarker }>>([])
  const carMarkersRef = useRef<Record<string, L.CircleMarker | L.Marker>>({})
  const tripStatesRef = useRef<Record<string, TripState>>({})
  const activeTripRouteRef = useRef<L.Polyline | null>(null)
  const activeDestinationRef = useRef<L.CircleMarker | null>(null)
  const mapLayersRef = useRef<L.Layer[]>([])
  const mapAnimationRef = useRef<number | null>(null)
  const dragStateRef = useRef<{ kind: 'fleet' | 'global' | null; startY: number; startScrollTop: number }>({
    kind: null,
    startY: 0,
    startScrollTop: 0,
  })
  const [scrollTop, setScrollTop] = useState(0)
  const [scrollHeight, setScrollHeight] = useState(1)
  const [clientHeight, setClientHeight] = useState(1)
  const [globalScrollTop, setGlobalScrollTop] = useState(0)
  const [globalScrollHeight, setGlobalScrollHeight] = useState(1)
  const [globalClientHeight, setGlobalClientHeight] = useState(1)
  const [logTick, setLogTick] = useState(0)
  const [liveLogPulse, setLiveLogPulse] = useState(0)
  const allFleet = useMemo(() => {
    const now = new Date()
    return [...fleet, ...extraFleet].map((car, idx) => {
      const normalizedAlert = car.status === 'Вне сервиса' ? false : Boolean(car.hasAlert)
      const rawTemplates = logsByCarId[car.id] ?? defaultIncidentTemplates
      const normalizedLogs = normalizedAlert
        ? logTemplatesWithTimes(shuffleLogTemplates(rawTemplates), now)
        : logTemplatesWithTimes(
            shuffleLogTemplates(
              Array.from({ length: 4 }).map((_, logIdx) => {
                const template = normalStatusTemplates[(idx + logIdx) % normalStatusTemplates.length]
                return {
                  message: template.message,
                  critical: false as const,
                  icon: template.icon,
                }
              }),
            ),
            now,
          )

      return {
        ...car,
        hasAlert: normalizedAlert,
        alertIndicators: car.status === 'Вне сервиса' ? [] : car.alertIndicators ?? [],
        uid: `${car.id}-${idx}`,
        logs: normalizedLogs,
      }
    })
  }, [logTick])
  const [activeFilter, setActiveFilter] = useState<FleetFilter>('all')
  const [selectedCarUid, setSelectedCarUid] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isPreloaderVisible, setIsPreloaderVisible] = useState(true)
  const [isGlobalLogExpanded, setIsGlobalLogExpanded] = useState(false)
  const [statusCopyToastVisible, setStatusCopyToastVisible] = useState(false)
  const statusCopyToastTimerRef = useRef<number | null>(null)

  const showStatusCopiedToast = useCallback(() => {
    if (statusCopyToastTimerRef.current !== null) window.clearTimeout(statusCopyToastTimerRef.current)
    setStatusCopyToastVisible(true)
    statusCopyToastTimerRef.current = window.setTimeout(() => {
      setStatusCopyToastVisible(false)
      statusCopyToastTimerRef.current = null
    }, 2500)
  }, [])

  useEffect(() => {
    return () => {
      if (statusCopyToastTimerRef.current !== null) window.clearTimeout(statusCopyToastTimerRef.current)
    }
  }, [])

  const handleCopyLogStatus = useCallback(
    (text: string) => {
      void copyTextToClipboard(text).then((ok) => {
        if (ok) showStatusCopiedToast()
      })
    },
    [showStatusCopiedToast],
  )

  const isIndicatorHot = (key: CarIndicatorKey) =>
    Boolean(selectedCar?.hasAlert && selectedCar?.alertIndicators?.includes(key))

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsPreloaderVisible(false)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      setLiveLogPulse((n) => n + 1)
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    const bump = () => setLogTick((n) => n + 1)
    const id = window.setInterval(bump, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') bump()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  useEffect(() => {
    if (isGlobalLogExpanded) return
    const map = leafletMapRef.current
    if (!map) return
    const timer = window.setTimeout(() => {
      map.invalidateSize()
    }, 120)
    return () => window.clearTimeout(timer)
  }, [isGlobalLogExpanded])

  const alertCount = useMemo(() => allFleet.filter((car) => car.hasAlert).length, [allFleet])
  const filteredFleet = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const base = allFleet.filter((car) => {
      if (activeFilter === 'alerts') return Boolean(car.hasAlert)
      const matchesStatus =
        activeFilter === 'all'
          ? true
          : activeFilter === 'trip'
            ? car.status === 'В поездке'
            : activeFilter === 'free'
              ? car.status === 'Свободен'
              : activeFilter === 'charge'
                ? car.status === 'На зарядке'
                : car.status === 'Вне сервиса'

      if (!matchesStatus) return false
      if (!normalizedQuery) return true
      return car.id.toLowerCase().includes(normalizedQuery) || car.model.toLowerCase().includes(normalizedQuery)
    })

    if (activeFilter !== 'all') return base

    const statusRank: Record<CarStatus, number> = {
      'В поездке': 1,
      'Свободен': 2,
      'На зарядке': 3,
      'Вне сервиса': 4,
    }

    return base
      .map((car, idx) => ({ car, idx }))
      .sort((a, b) => {
        const aRank = a.car.hasAlert ? 0 : statusRank[a.car.status]
        const bRank = b.car.hasAlert ? 0 : statusRank[b.car.status]
        if (aRank !== bRank) return aRank - bRank
        return a.idx - b.idx
      })
      .map(({ car }) => car)
  }, [activeFilter, allFleet, searchQuery])

  const selectedCar = useMemo(() => allFleet.find((car) => car.uid === selectedCarUid) ?? null, [allFleet, selectedCarUid])
  const globalCarLogs = useMemo(() => {
    const now = new Date()
    const shuffled = shuffleLogTemplates(globalLogTemplates)
    return shuffled.map((template, idx) => {
      const car = allFleet[idx % allFleet.length]
      const d = new Date(now.getTime())
      d.setMinutes(d.getMinutes() - idx)
      const time = formatLogClock(d)
      return {
        ...template,
        time,
        sourceCar: `${car.model} • ${car.id}`,
        sourceUid: car.uid ?? null,
      }
    })
  }, [allFleet, logTick])

  useEffect(() => {
    setSelectedCarUid(null)
  }, [activeFilter])

  useEffect(() => {
    if (selectedCarUid && !filteredFleet.some((car) => car.uid === selectedCarUid)) {
      setSelectedCarUid(null)
    }
  }, [filteredFleet, selectedCarUid])

  useEffect(() => {
    if (selectedCarUid !== null) return
    if (activeTripRouteRef.current) {
      activeTripRouteRef.current.remove()
      activeTripRouteRef.current = null
    }
    if (activeDestinationRef.current) {
      activeDestinationRef.current.remove()
      activeDestinationRef.current = null
    }
  }, [selectedCarUid])

  useEffect(() => {
    const node = fleetListRef.current
    if (!node) return

    const updateMetrics = () => {
      setScrollTop(node.scrollTop)
      setScrollHeight(node.scrollHeight)
      setClientHeight(node.clientHeight)
    }

    updateMetrics()
    node.addEventListener('scroll', updateMetrics, { passive: true })
    window.addEventListener('resize', updateMetrics)

    return () => {
      node.removeEventListener('scroll', updateMetrics)
      window.removeEventListener('resize', updateMetrics)
    }
  }, [])

  useEffect(() => {
    const node = globalLogListRef.current
    if (!node) return

    const updateMetrics = () => {
      setGlobalScrollTop(node.scrollTop)
      setGlobalScrollHeight(node.scrollHeight)
      setGlobalClientHeight(node.clientHeight)
    }

    updateMetrics()
    node.addEventListener('scroll', updateMetrics, { passive: true })
    window.addEventListener('resize', updateMetrics)

    return () => {
      node.removeEventListener('scroll', updateMetrics)
      window.removeEventListener('resize', updateMetrics)
    }
  }, [])

  useEffect(() => {
    if (!mapElementRef.current || leafletMapRef.current) return

    const defaultCenter: [number, number] = [55.7558, 37.6176]
    const defaultZoom = 13

    const map = L.map(mapElementRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView(defaultCenter, defaultZoom)

    map.on('click', () => {
      setSelectedCarUid(null)
      if (activeTripRouteRef.current) {
        activeTripRouteRef.current.remove()
        activeTripRouteRef.current = null
      }
      if (activeDestinationRef.current) {
        activeDestinationRef.current.remove()
        activeDestinationRef.current = null
      }
    })

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
    }).addTo(map)

    leafletMapRef.current = map

    return () => {
      if (mapAnimationRef.current !== null) {
        window.clearInterval(mapAnimationRef.current)
        mapAnimationRef.current = null
      }
      mapLayersRef.current.forEach((layer) => layer.remove())
      mapLayersRef.current = []
      movingMarkersRef.current = []
      map.remove()
      leafletMapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = leafletMapRef.current
    if (!map) return

    if (mapAnimationRef.current !== null) {
      window.clearInterval(mapAnimationRef.current)
      mapAnimationRef.current = null
    }
    movingMarkersRef.current = []
    carMarkersRef.current = {}
    mapLayersRef.current.forEach((layer) => layer.remove())
    mapLayersRef.current = []
    if (activeTripRouteRef.current) {
      activeTripRouteRef.current.remove()
      activeTripRouteRef.current = null
    }
    if (activeDestinationRef.current) {
      activeDestinationRef.current.remove()
      activeDestinationRef.current = null
    }

    const tripCars = filteredFleet.filter((car) => car.status === 'В поездке').slice(0, 7)
    const freeCars = filteredFleet.filter((car) => car.status === 'Свободен').slice(0, 4)
    const chargingCars = filteredFleet.filter((car) => car.status === 'На зарядке').slice(0, 4)
    const outCars = filteredFleet.filter((car) => car.status === 'Вне сервиса').slice(0, 4)

    movingMarkersRef.current = tripCars.map((car, idx) => {
      const uid = car.uid ?? `${car.id}-${idx}`
      if (!tripStatesRef.current[uid]) {
        const routeIndex = idx % ROAD_ROUTES.length
        const routeSegmentCount = ROAD_ROUTES[routeIndex].length - 1
        const phase = (idx / Math.max(1, tripCars.length) + normalizedHash(uid)) % 1
        const scaled = phase * routeSegmentCount
        tripStatesRef.current[uid] = {
          routeIndex,
          segmentIndex: Math.floor(scaled),
          segmentProgress: scaled % 1,
          speed: 0.01 + normalizedHash(uid) * 0.004,
        }
      }
      const state = tripStatesRef.current[uid]
      const route = ROAD_ROUTES[state.routeIndex]
      const fromPoint = route[state.segmentIndex]
      const toPoint = route[(state.segmentIndex + 1) % route.length]
      const lat = fromPoint[0] + (toPoint[0] - fromPoint[0]) * state.segmentProgress
      const lng = fromPoint[1] + (toPoint[1] - fromPoint[1]) * state.segmentProgress
      const markerColor = car.hasAlert ? '#ff0000' : '#4ca9ff'
      const marker = L.circleMarker([lat, lng], {
        radius: 6,
        color: markerColor,
        fillColor: markerColor,
        fillOpacity: 0.9,
        weight: 2,
      })
        .bindTooltip(buildTooltipHtml(car), {
          direction: 'top',
          offset: [0, -8],
          opacity: 1,
          className: 'map-tooltip-dark',
        })
        .addTo(map)
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event)
        setSelectedCarUid(car.uid ?? null)
        const currentState = tripStatesRef.current[uid]
        if (!currentState) return
        const route = ROAD_ROUTES[currentState.routeIndex]
        const destination = route[route.length - 1]

        if (activeTripRouteRef.current) activeTripRouteRef.current.remove()
        if (activeDestinationRef.current) activeDestinationRef.current.remove()

        activeTripRouteRef.current = L.polyline(route, {
          color: car.hasAlert ? '#ff0000' : '#4ca9ff',
          weight: 4,
          opacity: 0.85,
        }).addTo(map)

        activeDestinationRef.current = L.circleMarker(destination, {
          radius: 8,
          color: '#ffffff',
          fillColor: '#ffffff',
          fillOpacity: 0.9,
          weight: 2,
        })
          .bindTooltip('Точка назначения', {
            direction: 'top',
            offset: [0, -8],
            opacity: 1,
            className: 'map-tooltip-dark',
          })
          .addTo(map)
      })
      mapLayersRef.current.push(marker)
      carMarkersRef.current[uid] = marker
      return { uid, marker }
    })

    const freeAnchors: [number, number][] = [
      [55.7638, 37.6225],
      [55.7518, 37.5988],
      [55.7442, 37.6329],
      [55.7589, 37.6454],
    ]
    freeCars.forEach((car, idx) => {
      const [lat, lng] = freeAnchors[idx % freeAnchors.length]
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'free-car-marker-wrap',
          html: '<span class="free-car-marker-ring" aria-hidden="true"></span>',
          iconSize: [12, 12],
          iconAnchor: [6, 6],
        }),
      })
        .bindTooltip(buildTooltipHtml(car), { direction: 'top', offset: [0, -8], opacity: 1, className: 'map-tooltip-dark' })
        .addTo(map)
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event)
        setSelectedCarUid(car.uid ?? null)
      })
      mapLayersRef.current.push(marker)
      if (car.uid) carMarkersRef.current[car.uid] = marker
    })

    const chargingAnchors: [number, number][] = [
      [55.7701, 37.6397],
      [55.7388, 37.6076],
      [55.7486, 37.6552],
      [55.7559, 37.5789],
    ]
    chargingCars.forEach((car, idx) => {
      const [lat, lng] = chargingAnchors[idx % chargingAnchors.length]
      const chargeValue = Math.max(0, Math.min(100, car.charge))
      const marker = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'charging-marker-wrap',
          html: `<span class="charging-marker" style="--charge:${chargeValue}"></span>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10],
        }),
      })
        .bindTooltip(buildTooltipHtml(car), { direction: 'top', offset: [0, -8], opacity: 1, className: 'map-tooltip-dark' })
        .addTo(map)
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event)
        setSelectedCarUid(car.uid ?? null)
      })
      mapLayersRef.current.push(marker)
      if (car.uid) carMarkersRef.current[car.uid] = marker
    })

    const outAnchors: [number, number][] = [
      [55.7726, 37.6051],
      [55.7399, 37.6421],
      [55.7461, 37.5874],
      [55.7612, 37.6648],
    ]
    outCars.forEach((car, idx) => {
      const [lat, lng] = outAnchors[idx % outAnchors.length]
      const marker = L.circleMarker([lat, lng], {
        radius: 6,
        color: 'rgba(255,255,255,0.45)',
        fillColor: 'rgba(255,255,255,0.45)',
        fillOpacity: 0.3,
        weight: 2,
      })
        .bindTooltip(buildTooltipHtml(car), { direction: 'top', offset: [0, -8], opacity: 1, className: 'map-tooltip-dark' })
        .addTo(map)
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event)
        setSelectedCarUid(car.uid ?? null)
      })
      mapLayersRef.current.push(marker)
      if (car.uid) carMarkersRef.current[car.uid] = marker
    })

    if (movingMarkersRef.current.length > 0) {
      mapAnimationRef.current = window.setInterval(() => {
        movingMarkersRef.current.forEach(({ uid, marker }) => {
          const state = tripStatesRef.current[uid]
          if (!state) return
          const route = ROAD_ROUTES[state.routeIndex]
          const lastSegment = route.length - 1

          state.segmentProgress += state.speed
          if (state.segmentProgress >= 1) {
            state.segmentProgress = 0
            state.segmentIndex = (state.segmentIndex + 1) % lastSegment
          }

          const fromPoint = route[state.segmentIndex]
          const toPoint = route[(state.segmentIndex + 1) % route.length]
          const t = state.segmentProgress
          const lat = fromPoint[0] + (toPoint[0] - fromPoint[0]) * t
          const lng = fromPoint[1] + (toPoint[1] - fromPoint[1]) * t
          marker.setLatLng([lat, lng])
        })
      }, 260)
    }

    return () => {
      if (mapAnimationRef.current !== null) {
        window.clearInterval(mapAnimationRef.current)
        mapAnimationRef.current = null
      }
      movingMarkersRef.current = []
      carMarkersRef.current = {}
      mapLayersRef.current.forEach((layer) => layer.remove())
      mapLayersRef.current = []
      if (activeTripRouteRef.current) {
        activeTripRouteRef.current.remove()
        activeTripRouteRef.current = null
      }
      if (activeDestinationRef.current) {
        activeDestinationRef.current.remove()
        activeDestinationRef.current = null
      }
    }
  }, [filteredFleet])

  const thumbHeight = Math.max(52, (clientHeight / scrollHeight) * clientHeight)
  const maxThumbOffset = Math.max(0, clientHeight - thumbHeight)
  const thumbOffset =
    scrollHeight > clientHeight ? (scrollTop / (scrollHeight - clientHeight)) * maxThumbOffset : 0
  const globalThumbHeight = Math.max(52, (globalClientHeight / globalScrollHeight) * globalClientHeight)
  const globalMaxThumbOffset = Math.max(0, globalClientHeight - globalThumbHeight)
  const globalThumbOffset =
    globalScrollHeight > globalClientHeight
      ? (globalScrollTop / (globalScrollHeight - globalClientHeight)) * globalMaxThumbOffset
      : 0

  const handleDragMove = (event: MouseEvent) => {
    const activeKind = dragStateRef.current.kind
    if (!activeKind) return
    const listNode = activeKind === 'fleet' ? fleetListRef.current : globalLogListRef.current
    if (!listNode) return

    const currentClientHeight = activeKind === 'fleet' ? clientHeight : globalClientHeight
    const currentScrollHeight = activeKind === 'fleet' ? scrollHeight : globalScrollHeight
    const currentThumbHeight = activeKind === 'fleet' ? thumbHeight : globalThumbHeight
    const maxScrollTop = Math.max(0, currentScrollHeight - currentClientHeight)
    const maxTrackOffset = Math.max(1, currentClientHeight - currentThumbHeight)
    const deltaY = event.clientY - dragStateRef.current.startY
    const deltaScroll = (deltaY / maxTrackOffset) * maxScrollTop
    listNode.scrollTop = Math.max(0, Math.min(maxScrollTop, dragStateRef.current.startScrollTop + deltaScroll))
  }

  const stopDrag = () => {
    dragStateRef.current.kind = null
    window.removeEventListener('mousemove', handleDragMove)
    window.removeEventListener('mouseup', stopDrag)
  }

  const startThumbDrag = (kind: 'fleet' | 'global', event: { clientY: number; preventDefault: () => void }) => {
    const listNode = kind === 'fleet' ? fleetListRef.current : globalLogListRef.current
    if (!listNode) return
    event.preventDefault()
    dragStateRef.current = {
      kind,
      startY: event.clientY,
      startScrollTop: listNode.scrollTop,
    }
    window.addEventListener('mousemove', handleDragMove)
    window.addEventListener('mouseup', stopDrag)
  }

  const handleZoomIn = () => leafletMapRef.current?.zoomIn()
  const handleZoomOut = () => leafletMapRef.current?.zoomOut()
  const handleResetView = () => leafletMapRef.current?.setView([55.7558, 37.6176], 13)
  const handleFocusCar = (uid: string | null) => {
    if (!uid) return
    const map = leafletMapRef.current
    const marker = carMarkersRef.current[uid]
    if (!map || !marker) return
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 14), { duration: 0.5 })
  }
  const handleFocusSelectedCar = () => {
    handleFocusCar(selectedCarUid)
  }

  return (
    <>
      {isPreloaderVisible ? (
        <div className="preloader-screen" aria-live="polite" aria-label="Загрузка интерфейса">
          <img className="preloader-logo" src="/logo.svg" alt="Логотип" />
          <div className="preloader-loading-block">
            <div className="preloader-track-wrap" aria-hidden="true">
              <div className="preloader-taxi-lane">
                <div className="preloader-taxi-rig">
                  <PreloaderPixelTaxi />
                </div>
              </div>
              <div className="preloader-track">
                <span className="preloader-progress" />
              </div>
            </div>
            <div className="preloader-powered">
              <div className="preloader-powered-row">
                <span className="preloader-powered-text">Powered by Cursor</span>
                <img className="preloader-powered-mark" src="/cursor.svg" alt="" aria-hidden="true" />
              </div>
              <p className="preloader-created-by">Created by Gleb M.</p>
            </div>
          </div>
        </div>
      ) : null}
      <main className="monitoring-page">
        <section className="fleet-panel">
        <div className="chips">
          <button className={`chip ${activeFilter === 'all' ? 'active' : ''}`} onClick={() => setActiveFilter('all')}>
            Все
          </button>
          <button className={`chip ${activeFilter === 'trip' ? 'active' : ''}`} onClick={() => setActiveFilter('trip')}>
            В поездке
          </button>
          <button className={`chip ${activeFilter === 'free' ? 'active' : ''}`} onClick={() => setActiveFilter('free')}>
            Свободны
          </button>
          <button className={`chip ${activeFilter === 'charge' ? 'active' : ''}`} onClick={() => setActiveFilter('charge')}>
            На зарядке
          </button>
          <button className={`chip ${activeFilter === 'out' ? 'active' : ''}`} onClick={() => setActiveFilter('out')}>
            Вне сервиса
          </button>
          <button
            className={`chip alert ${activeFilter === 'alerts' ? 'active' : ''}`}
            type="button"
            aria-label={`Автомобилей с ошибкой: ${alertCount}`}
            onClick={() => setActiveFilter((prev) => (prev === 'alerts' ? 'all' : 'alerts'))}
          >
            <span>{alertCount}</span>
            <img src="/warning-line.svg" alt="" aria-hidden="true" />
          </button>
        </div>
        <div className="search-box">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Поиск по номеру автомобиля"
            aria-label="Поиск по автомобилю"
          />
          <img src="/uil_search.svg" alt="" aria-hidden="true" />
        </div>
        <div className="fleet-list-wrap">
          <div className="fleet-list" ref={fleetListRef}>
            {filteredFleet.map((car, idx) => {
              const displayCharge = car.status === 'Вне сервиса' ? 0 : car.charge
              return (
                <article
                  key={car.uid ?? `${car.id}-${idx}`}
                  className={`fleet-item ${selectedCar?.uid === car.uid ? 'selected' : ''}`}
                  onClick={() => setSelectedCarUid(car.uid ?? null)}
                >
                <div className="fleet-item-top">
                  <span className="fleet-charge">{displayCharge}%</span>
                  <span className="fleet-model">{car.model}</span>
                  <span className="fleet-id">{car.id}</span>
                </div>
                <div className="fleet-item-bottom">
                  <BatteryDots charge={displayCharge} />
                  <span
                    className="fleet-status status-clickable"
                    style={{ color: getStatusColor(car) }}
                    onClick={(event) => {
                      event.stopPropagation()
                      setSelectedCarUid(car.uid ?? null)
                      handleFocusCar(car.uid ?? null)
                    }}
                  >
                    {car.status}
                  </span>
                  <span className="fleet-item-icon">
                    {car.hasAlert ? <img src="/warning-line.svg" alt="alert" /> : null}
                    {car.chargingIcon ? <img src="/battery-charge-28-regular.svg" alt="charging" /> : null}
                  </span>
                </div>
                </article>
              )
            })}
            {filteredFleet.length === 0 ? <p className="fleet-empty">Нет машин по выбранному фильтру</p> : null}
          </div>
          <div className="fleet-scrollbar">
            <span
              className="fleet-scroll-thumb"
              style={{ height: `${thumbHeight}px`, transform: `translateY(${thumbOffset}px)` }}
              onMouseDown={(event) => startThumbDrag('fleet', event)}
            />
          </div>
        </div>
        <div className="fleet-shadow" />
      </section>

      <section className={`map-panel${isGlobalLogExpanded ? ' map-panel--log-expanded' : ''}`}>
        <div className="map-main">
          <header className="map-header">
            <MapLogoMark />
            <div className="stats">
              <span className="stat-item">
                <span className="stat-label">все</span>
                <span className="stat-value">124</span>
              </span>
              <span className="stat-item">
                <span className="stat-label">в поездке</span>
                <span className="stat-value">80</span>
              </span>
              <span className="stat-item">
                <span className="stat-label">свободны</span>
                <span className="stat-value">19</span>
              </span>
              <span className="stat-item">
                <span className="stat-label">на зарядке</span>
                <span className="stat-value">6</span>
              </span>
              <span className="stat-item">
                <span className="stat-label">вне сервиса</span>
                <span className="stat-value">18</span>
              </span>
            </div>
          </header>
          <div className="map-canvas">
            <div className="map-live" ref={mapElementRef} />
            <div className="map-controls">
              <button onClick={handleZoomOut}>-</button>
              <button onClick={handleZoomIn}>+</button>
              <button>
                <img src="/material-symbols_layers-rounded.svg" alt="" aria-hidden="true" />
              </button>
              <button onClick={handleResetView}>
                <img src="/uil_search.svg" alt="" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        <div className={`map-footer${isGlobalLogExpanded ? ' map-footer--expanded' : ''}`}>
          <div className="map-footer-head">
            <h2>Общее логирование</h2>
            <button
              type="button"
              className="map-footer-expand"
              aria-expanded={isGlobalLogExpanded}
              aria-label={isGlobalLogExpanded ? 'Свернуть общее логирование' : 'Развернуть общее логирование'}
              onClick={() => setIsGlobalLogExpanded((v) => !v)}
            >
              <img src="/expand.svg" alt="" aria-hidden="true" />
            </button>
          </div>
          <div className="map-footer-log-head" aria-hidden="true">
            <span>время</span>
            <span>статус</span>
          </div>
          <div className="map-footer-list-wrap">
            <div className="map-footer-list" ref={globalLogListRef}>
              {globalCarLogs.map((event, idx) => (
                <div className="map-footer-row" key={`${idx}-${event.message}-${event.sourceCar}`}>
                  <span>{formatLiveLogTime(idx, liveLogPulse)}</span>
                  <div
                    className="map-footer-status-wrap"
                    onClick={() => handleCopyLogStatus(`${event.message} ${event.sourceCar}`)}
                  >
                    <span className={event.critical ? 'critical' : 'normal'}>{event.message}</span>
                    <em>
                      <button
                        type="button"
                        className="log-car-link"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (!event.sourceUid) return
                          setSelectedCarUid(event.sourceUid)
                        }}
                      >
                        {event.sourceCar}
                      </button>
                    </em>
                  </div>
                </div>
              ))}
            </div>
            <div className="fleet-scrollbar global-scrollbar">
              <span
                className="fleet-scroll-thumb"
                style={{ height: `${globalThumbHeight}px`, transform: `translateY(${globalThumbOffset}px)` }}
                onMouseDown={(event) => startThumbDrag('global', event)}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="events-panel">
        <article className="selected-car">
          <div className="selected-car-top">
            <div className="selected-car-left">
              <img className="car-badge" src="https://www.figma.com/api/mcp/asset/a86eaf06-1e91-45f8-8865-202791400a5b" alt="" />
              <span className="charge">{selectedCar ? `${selectedCar.status === 'Вне сервиса' ? 0 : selectedCar.charge}%` : '0%'}</span>
              <BatteryDots charge={selectedCar ? (selectedCar.status === 'Вне сервиса' ? 0 : selectedCar.charge) : 0} />
            </div>
            <div className="selected-car-right">
              <div className="selected-car-row">
                <span className="car-name">{selectedCar?.model ?? '-'}</span>
                <span className="car-id">{selectedCar?.id ?? '-'}</span>
              </div>
              <div className="selected-car-row selected-status-row">
                <span
                  className="status status-clickable"
                  style={{ color: selectedCar ? getStatusColor(selectedCar) : 'rgba(255,255,255,0.7)' }}
                  onClick={handleFocusSelectedCar}
                >
                  {selectedCar?.status ?? '-'}
                </span>
              </div>
              <div className="selected-car-row selected-status-row">
                <div className="car-indicators">
                  <span
                    className={`indicator-with-tip ${isIndicatorHot('engine') ? 'indicator-hot' : 'indicator-dim'}`}
                    data-tooltip={indicatorLabels.engine}
                    aria-label={indicatorLabels.engine}
                  >
                    <EngineIcon />
                  </span>
                  <span
                    className={`indicator-with-tip ${isIndicatorHot('battery') ? 'indicator-hot' : 'indicator-dim'}`}
                    data-tooltip={indicatorLabels.battery}
                    aria-label={indicatorLabels.battery}
                  >
                    <BatteryIcon />
                  </span>
                  <span
                    className={`indicator-with-tip ${isIndicatorHot('wheel') ? 'indicator-hot' : 'indicator-dim'}`}
                    data-tooltip={indicatorLabels.wheel}
                    aria-label={indicatorLabels.wheel}
                  >
                    <WheelIcon />
                  </span>
                  <span
                    className={`indicator-with-tip ${isIndicatorHot('temperature') ? 'indicator-hot' : 'indicator-dim'}`}
                    data-tooltip={indicatorLabels.temperature}
                    aria-label={indicatorLabels.temperature}
                  >
                    <TemperatureIcon />
                  </span>
                  <span
                    className={`indicator-with-tip ${isIndicatorHot('lidar') ? 'indicator-hot' : 'indicator-dim'}`}
                    data-tooltip={indicatorLabels.lidar}
                    aria-label={indicatorLabels.lidar}
                  >
                    <LidarIcon />
                  </span>
                </div>
                {selectedCar?.hasAlert ? <img className="warning-main" src="/warning-line.svg" alt="" aria-hidden="true" /> : null}
              </div>
            </div>
          </div>
        </article>
        <article className="operator-actions">
          {selectedCar ? (
            <>
            <h2>Действия оператора</h2>
            <div className="actions-grid">
              <button type="button" className="action-btn primary">
                Безопасная остановка
              </button>
              <button type="button" className="action-btn">
                Связь с пассажиром
              </button>
              <button type="button" className="action-btn">
                Переназначить маршрут
              </button>
              <button type="button" className="action-btn">
                Отправить инженера
              </button>
              <button type="button" className="action-btn warning">
                Снизить скорость
              </button>
              <button type="button" className="action-btn danger">
                Вывести из сервиса
              </button>
            </div>
            </>
          ) : null}
        </article>
        <article className="events-log">
          <header>
            <h1>Логирование</h1>
            <button className="export-btn">
              <span>Экспорт</span>
              <ExportIcon />
            </button>
          </header>
          <div className="log-head">
            <span>время</span>
            <span>статус</span>
          </div>
          <div className="log-list">
            {(selectedCar?.logs ?? []).map((event, idx) => (
              <div className="log-row" key={`${idx}-${event.message}`}>
                <span>{formatLiveLogTime(idx, liveLogPulse)}</span>
                <div
                  className="log-status-copy-wrap"
                  onClick={() => handleCopyLogStatus(event.message)}
                >
                  <span className={`log-message ${event.critical ? 'critical' : 'normal'}`}>
                    {event.message}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </article>
        </section>
      </main>
      {statusCopyToastVisible ? (
        <div className="copy-status-toast" role="status" aria-live="polite">
          Статус скопирован
        </div>
      ) : null}
    </>
  )
}

export default App
