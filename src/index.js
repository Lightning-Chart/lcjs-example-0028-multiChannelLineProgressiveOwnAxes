/**
 * Lightning-fast Line Chart visualization over multiple channels that progress on the same X Axis
 */

const lcjs = require('@lightningchart/lcjs')

// NOTE: Assuming predefined number of stacked channels.
const SIGNALS = new Array(5).fill(0).map((_, i) => ({
    title: `Ch ${i + 1}`,
}))
const DEFAULT_X_RANGE_MS = 30 * 1000
const dataPointsPerSecond = 1000 // 1000 Hz

const {
    lightningChart,
    emptyLine,
    DataSetXY,
    AxisTickStrategies,
    AxisScrollStrategies,
    UIOrigins,
    UIDraggingModes,
    Themes,
} = lcjs

const lc = lightningChart({
            resourcesBaseUrl: new URL(document.head.baseURI).origin + new URL(document.head.baseURI).pathname + 'resources/',
        })
const chart = lc
    .ChartXY({
        theme: Themes[new URLSearchParams(window.location.search).get('theme') || 'darkGold'] || undefined,
    })
    .setTitle(`Multi-channel real-time monitoring (${SIGNALS.length} chs, 1000 Hz)`)

const ekgImage = new Image()
ekgImage.crossOrigin = ''
ekgImage.src = document.head.baseURI + 'examples/assets/0028/ekg.png'
const ekgIcon = chart.engine.addCustomIcon(ekgImage, { height: 18 })

const axisX = chart
    .getDefaultAxisX()
    .setTickStrategy(AxisTickStrategies.Time)
    .setStrokeStyle(emptyLine)
    .setScrollStrategy(AxisScrollStrategies.scrolling)
    .setDefaultInterval((state) => ({ end: state.dataMax, start: (state.dataMax ?? 0) - DEFAULT_X_RANGE_MS, stopAxisAfter: false }))

// Single data set with shared timestamps
const dataSet = new DataSetXY({
    schema: {
        x: {
            auto: {
                step: 1000 / dataPointsPerSecond,
            },
        },
        ...Object.fromEntries(Array.from({ length: SIGNALS.length }, (_, i) => [`y${i}`, { pattern: null }])),
    },
}).setMaxSampleCount(50000)

chart.getDefaultAxisY().dispose()
const channels = SIGNALS.map((signal, iSignal) => {
    const iStack = SIGNALS.length - (iSignal + 1)
    const axisY = chart
        .addAxisY({ iStack })
        .setTitle(signal.title)
        .setTitleRotation(0)
        .setAnimationScroll(false)
        .setMargins(iStack > 0 ? 5 : 0, iSignal === 0 ? 35 : iStack < SIGNALS.length - 1 ? 5 : 0)
    const series = chart
        .addLineSeries({
            automaticColorIndex: iSignal,
            yAxis: axisY,
        })
        .setName(`Channel ${iSignal + 1}`)
        .setDataSet(dataSet, { x: 'x', y: `y${iSignal}` })
        // Use 2 thickness for smooth anti-aliased thick lines with the best visual look
        .setStrokeStyle((style) => style.setThickness(2))
        .setIcon(ekgIcon)

    // When series is hidden, also hide the entire Y axis.
    series.addEventListener('visiblechange', (event) => {
        const { isVisible } = event
        axisY.setVisible(isVisible)
    })

    return { series, axisY }
})

// Add LCJS user interface button for resetting view.
const buttonReset = chart
    .addUIElement()
    .setText('Reset')
    .setPosition({ x: 0, y: 0 })
    .setOrigin(UIOrigins.LeftBottom)
    .setMargin({ left: 4, bottom: 4 })
    .setDraggingMode(UIDraggingModes.notDraggable)
buttonReset.addEventListener('click', (event) => {
    const xMax = channels[0].series.getXMax()
    axisX.setInterval({ start: xMax - DEFAULT_X_RANGE_MS, end: xMax, stopAxisAfter: false })
    channels.forEach((channel) => channel.axisY.fit())
})

// Generate data sets that is repeated for each channel for demonstration purposes.
const randomData = [
    { length: Math.ceil(400 * Math.PI), func: (x) => 8 * Math.sin(x / 200) },
    { length: Math.ceil(3200 * Math.PI), func: (x) => 7 * Math.sin(x / 1600) },
    { length: Math.ceil(800 * Math.PI), func: (x) => 4 * (Math.cos(x / 400) + Math.sin(x / 200)) },
    { length: Math.ceil(800 * Math.PI), func: (x) => 6 * Math.sin(x / 100) + Math.cos(x / 400) },
    { length: Math.ceil(1800 * Math.PI), func: (x) => 8 * Math.cos(x / 900) },
].map((config) => {
    const data = []
    data.length = config.length
    for (let i = 0; i < config.length; i += 1) {
        const y = config.func(i)
        data[i] = y
    }
    return data
})

// Stream data into series.
let tStart = window.performance.now()
let pushedDataCount = 0
const streamData = () => {
    const tNow = window.performance.now()
    // NOTE: This code is for example purposes (streaming stable data rate without destroying browser when switching tabs etc.)
    // In real use cases, data should be pushed in when it comes.
    const shouldBeDataPointsCount = Math.floor((dataPointsPerSecond * (tNow - tStart)) / 1000)
    const newDataPointsCount = Math.min(shouldBeDataPointsCount - pushedDataCount, 1000) // Add max 1000 data points per frame into a series. This prevents massive performance spikes when switching tabs for long times
    const newSamples = Object.fromEntries(Array.from({ length: SIGNALS.length }, (_, i) => [`y${i}`, []]))
    for (let iChannel = 0; iChannel < channels.length; iChannel++) {
        const randomDataCh = randomData[iChannel % randomData.length]
        const arr = newSamples[`y${iChannel}`]
        for (let iDp = 0; iDp < newDataPointsCount; iDp++) {
            const iData = (pushedDataCount + iDp) % randomDataCh.length
            const y = randomDataCh[iData]
            arr.push(y)
        }
    }
    dataSet.appendSamples(newSamples)
    pushedDataCount += newDataPointsCount
    requestAnimationFrame(streamData)
}
streamData()

// Measure FPS.
let tFpsStart = window.performance.now()
let frames = 0
let fps = 0
const title = chart.getTitle()
const recordFrame = () => {
    frames++
    const tNow = window.performance.now()
    fps = 1000 / ((tNow - tFpsStart) / frames)
    requestAnimationFrame(recordFrame)

    chart.setTitle(`${title} (FPS: ${fps.toFixed(1)})`)
}
requestAnimationFrame(recordFrame)
setInterval(() => {
    tFpsStart = window.performance.now()
    frames = 0
}, 5000)
