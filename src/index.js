/**
 * Lightning-fast Line Chart visualization over multiple channels that progress on the same X Axis
 */

const lcjs = require("@arction/lcjs");
const xydata = require('@arction/xydata')

// NOTE: Assuming predefined number of stacked channels.
const SIGNALS = new Array(10).fill(0).map((_, i) => ({
  title: `Ch ${i + 1}`,
}));

const DEFAULT_X_RANGE_MS = 30 * 1000;

const {
  lightningChart,
  AutoCursorModes,
  emptyLine,
  AxisTickStrategies,
  AxisScrollStrategies,
  synchronizeAxisIntervals,
  UIOrigins,
  UIDraggingModes,
  translatePoint,
  LegendBoxBuilders,
  Themes,
} = lcjs;

const { createProgressiveFunctionGenerator } = xydata;

const dashboard = lightningChart()
  .Dashboard({
    numberOfColumns: 1,
    numberOfRows: SIGNALS.length,
    // theme: Themes.darkGold
  })
  .setSplitterStyle(emptyLine);

const channels = SIGNALS.map((signal, iSignal) => {
  const chart = dashboard
    .createChartXY({
      columnIndex: 0,
      rowIndex: iSignal,
    })
    .setTitle("")
    .setPadding({ top: 0, bottom: 0 })
    .setAutoCursorMode(AutoCursorModes.disabled)
    .setBackgroundStrokeStyle(emptyLine)
    .setMouseInteractions(false);

  const axisX = chart
    .getDefaultAxisX()
    .setTickStrategy(AxisTickStrategies.Empty)
    .setStrokeStyle(emptyLine)
    .setScrollStrategy(AxisScrollStrategies.progressive)
    .setInterval(0, 10, false, true)
  const axisY = chart
    .getDefaultAxisY()
    .setTickStrategy(AxisTickStrategies.Empty)
    .setStrokeStyle(emptyLine)
    .setTitle(signal.title)
    .setTitleRotation(0)
    .setThickness(60);

  const series = chart
    .addLineSeries({
      dataPattern: { pattern: "ProgressiveX" },
      automaticColorIndex: iSignal,
    })
    .setName(`Channel ${iSignal + 1}`)
    .setDataCleaning({ minDataPointCount: 10000 });

  return { chart, series, axisX, axisY };
});
const channelTop = channels[0];
const channelBottom = channels[channels.length - 1];

channelTop.chart
  .setTitle("Multi-channel real-time monitoring (10 chs, 1000 Hz)")
  .setPadding({ top: 8 });

const axisX = channelBottom.axisX
  .setTickStrategy(AxisTickStrategies.Time, (ticks) =>
    ticks
      .setMajorTickStyle((major) => major.setGridStrokeStyle(emptyLine))
      .setMinorTickStyle((minor) => minor.setGridStrokeStyle(emptyLine))
  )
synchronizeAxisIntervals(
  axisX,
  ...channels.map((ch) => ch.axisX).filter((axis) => axis !== axisX)
);
axisX.setInterval(-DEFAULT_X_RANGE_MS, 0);

// Add legend
const legend = dashboard.addLegendBox(LegendBoxBuilders.VerticalLegendBox, dashboard.uiScale)
  .setPosition({ y: 50, x: translatePoint({ x: channelBottom.chart.pixelScale.x.getCellSize() - channelBottom.chart.getPadding().right, y: 0 }, channelBottom.chart.pixelScale, dashboard.uiScale).x })
  .setOrigin(UIOrigins.RightCenter)
channels.forEach(channel => legend.add(channel.series))

// Custom interactions for zooming in/out along Time axis while keeping data scrolling.
axisX
  .setNibInteractionScaleByDragging(false)
  .setNibInteractionScaleByWheeling(false)
  .setAxisInteractionZoomByWheeling(false);
const customZoomX = (_, event) => {
  const interval = axisX.getInterval();
  const range = interval.end - interval.start;
  const newRange = range + Math.sign(event.deltaY) * 0.1 * Math.abs(range);
  axisX.setInterval(interval.end - newRange, interval.end, false, false);
  event.preventDefault()
  event.stopPropagation()
};
axisX.onAxisInteractionAreaMouseWheel(customZoomX);
channels.forEach((channel) =>
  channel.chart.onSeriesBackgroundMouseWheel(customZoomX)
);

// Add LCJS user interface button for resetting view.
const buttonReset = dashboard
  .addUIElement()
  .setText("Reset")
  .setPosition({ x: 0, y: 0 })
  .setOrigin(UIOrigins.LeftBottom)
  .setMargin({ left: 4, bottom: 4 })
  .setDraggingMode(UIDraggingModes.notDraggable);
buttonReset.onMouseClick((_) => {
  const xMax = channels[0].series.getXMax();
  axisX.setInterval(xMax - DEFAULT_X_RANGE_MS, xMax, false, false);
  channels.forEach((channel) => channel.axisY.fit());
});

// Define unique signals that will be used for channels.
const signals = [
  { length: 400 * Math.PI, func: (x) => Math.sin(x / (200)) },
  { length: 400 * Math.PI, func: (x) => Math.cos(x / (200)) },
  { length: 800 * Math.PI, func: (x) => Math.cos(x / (400)) + Math.sin(x / (200)) },
  { length: 800 * Math.PI, func: (x) => Math.sin(x / (100)) +  Math.cos(x / (400)) },
  { length: 800 * Math.PI, func: (x) => Math.sin(x / (200)) * Math.cos(x / (400)) },
  { length: 1800 * Math.PI, func: (x) => Math.cos(x / (900)) },
  { length: 3200 * Math.PI, func: (x) => Math.sin(x / (1600)) },
  { length: 2600 * Math.PI, func: (x) => Math.sin(x / (400)) * Math.cos(x / (1300)) },
]
// Generate data sets for each signal.
Promise.all(
  signals.map((signal) =>
      createProgressiveFunctionGenerator()
          .setStart(0)
          .setEnd(signal.length)
          .setStep(1)
          .setSamplingFunction(signal.func)
          .generate()
          .toPromise()
          .then((data) => data.map((xy) => xy.y)),
  ),
)
.then((dataSets) => {
  // Stream data into series.
  let xPrev = 0
  let iSample = 0
  const streamData = () => {
    const newDataPointsCount = 60; // Matches 1000 Hz very roughly
    const xNow = window.performance.now()
    const xDelta = xNow - xPrev
    const seriesNewDataPoints = []
    for (let iChannel = 0; iChannel < channels.length; iChannel++) {
      const dataSet = dataSets[iChannel % (dataSets.length - 1)]
      const newDataPoints = []
      for (let iDp = 0; iDp < newDataPointsCount; iDp++) {
          const x = xPrev + ((iDp + 1) / newDataPointsCount) * xDelta
          const iData = (iSample + iDp) % (dataSet.length - 1)
          const y = dataSet[iData]
          const point = { x, y }
          newDataPoints.push(point)
      }
      seriesNewDataPoints[iChannel] = newDataPoints
    }
    channels.forEach((channel, iChannel) => channel.series.add(seriesNewDataPoints[iChannel]))
    xPrev = xNow
    iSample += newDataPointsCount
    requestAnimationFrame(streamData)
  }
  streamData()
})

// Measure FPS.
let tFpsStart = window.performance.now();
let frames = 0;
let fps = 0;
const title = channelTop.chart.getTitle();
const recordFrame = () => {
  frames++;
  const tNow = window.performance.now();
  fps = 1000 / ((tNow - tFpsStart) / frames);
  requestAnimationFrame(recordFrame);

  channelTop.chart.setTitle(`${title} (FPS: ${fps.toFixed(1)})`);
};
requestAnimationFrame(recordFrame);
setInterval(() => {
  tFpsStart = window.performance.now();
  frames = 0;
}, 5000);
