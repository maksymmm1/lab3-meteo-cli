import { Command, InvalidArgumentError } from "commander";
import { readFileSync, existsSync } from "fs";

const program = new Command();

program
  .name("meteo-cli")
  .description(
    "CLI-програма для роботи з JSON-документом доби вимірювань метеостанції (ЛР1, варіант 6)"
  )
  .version("1.0.0", "-v, --version", "показати версію програми")
  .option(
    "-f, --file <path>",
    "шлях до JSON-файлу з даними метеостанції",
    "data.json"
  );

function loadStation(filePath) {
  if (!existsSync(filePath)) {
    console.error(`Помилка: файл "${filePath}" не знайдено.`);
    process.exit(1);
  }

  let raw;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    console.error(`Помилка читання файлу "${filePath}": ${err.message}`);
    process.exit(1);
  }

  try {
    return JSON.parse(raw);
  } catch {
    console.error(`Помилка: файл "${filePath}" не є коректним JSON-документом.`);
    process.exit(1);
  }
}

function findSensor(station, sensorId) {
  const sensor = station.sensors.find((s) => s.sensorId === sensorId);
  if (!sensor) {
    const available = station.sensors.map((s) => s.sensorId).join(", ");
    console.error(`Помилка: датчик з ідентифікатором "${sensorId}" не знайдено.`);
    console.error(`Доступні датчики: ${available}`);
    process.exit(1);
  }
  return sensor;
}

function parseLimit(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new InvalidArgumentError("значення має бути додатним цілим числом.");
  }
  return n;
}

program
  .command("list")
  .description("показати стислий список датчиків станції")
  .option("-l, --limit <number>", "обмежити кількість датчиків у виводі", parseLimit)
  .action((options) => {
    const station = loadStation(program.opts().file);
    let sensors = station.sensors;
    if (options.limit) {
      sensors = sensors.slice(0, options.limit);
    }
    console.log(`Станція: ${station.stationName} (доба ${station.date})`);
    console.log(`Усього датчиків: ${station.sensors.length}, показано: ${sensors.length}`);
    sensors.forEach((s) => {
      console.log(
        `- ${s.sensorId} | ${s.type} | ${s.unit} | активний: ${s.isActive ? "так" : "ні"}`
      );
    });
  });

program
  .command("sensor")
  .description("показати один датчик цілком, з усіма полями")
  .argument("<sensorId>", "ідентифікатор датчика, наприклад TEMP-01")
  .action((sensorId) => {
    const station = loadStation(program.opts().file);
    const sensor = findSensor(station, sensorId);
    console.log(JSON.stringify(sensor, null, 2));
  });

program
  .command("field")
  .description(
    "показати значення окремого поля датчика, зокрема вкладеного (шлях через крапку)"
  )
  .argument("<sensorId>", "ідентифікатор датчика")
  .argument("<path>", 'шлях до поля, напр. "manufacturer" або "readings.0.value"')
  .action((sensorId, path) => {
    const station = loadStation(program.opts().file);
    const sensor = findSensor(station, sensorId);

    const keys = path.split(".");
    let current = sensor;

    for (const key of keys) {
      if (current === null) {
        console.log("null");
        return;
      }
      if (typeof current !== "object" || !(key in current)) {
        console.error(`Помилка: поле "${path}" не існує в датчику "${sensorId}".`);
        process.exit(1);
      }
      current = current[key];
    }

    if (current === null) {
      console.log("null");
    } else if (typeof current === "object") {
      console.log(JSON.stringify(current, null, 2));
    } else {
      console.log(String(current));
    }
  });

program
  .command("characteristics")
  .description("показати характеристики обраного датчика без серії показів")
  .argument("<sensorId>", "ідентифікатор датчика")
  .action((sensorId) => {
    const station = loadStation(program.opts().file);
    const sensor = findSensor(station, sensorId);
    const { readings, ...characteristics } = sensor;
    console.log(JSON.stringify(characteristics, null, 2));
  });

program
  .command("readings")
  .description("показати серію показів обраного датчика за добу")
  .argument("<sensorId>", "ідентифікатор датчика")
  .option(
    "--skip-missing",
    "не показувати покази, під час яких стався збій (value = null)",
    false
  )
  .action((sensorId, options) => {
    const station = loadStation(program.opts().file);
    const sensor = findSensor(station, sensorId);

    let readings = sensor.readings;
    if (options.skipMissing) {
      readings = readings.filter((r) => r.value !== null);
    }

    if (readings.length === 0) {
      console.log("Немає показів для відображення (можливо, усі відфільтровано як відсутні).");
      return;
    }

    readings.forEach((r) => {
      const valueText = r.value === null ? "немає даних (збій)" : `${r.value} ${sensor.unit}`;
      console.log(`${r.timestamp} -> ${valueText} [${r.status}]`);
    });
  });

program
  .command("stats")
  .description(
    "показати мінімум, максимум і середнє значення показів датчика без урахування відсутніх"
  )
  .argument("<sensorId>", "ідентифікатор датчика")
  .action((sensorId) => {
    const station = loadStation(program.opts().file);
    const sensor = findSensor(station, sensorId);

    const values = sensor.readings.map((r) => r.value).filter((v) => v !== null);

    if (values.length === 0) {
      console.error(
        `Помилка: у датчика "${sensorId}" немає жодного коректного показу для обчислення статистики.`
      );
      process.exit(1);
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;

    console.log(`Датчик: ${sensorId} (${sensor.type}, ${sensor.unit})`);
    console.log(`Враховано показів: ${values.length} з ${sensor.readings.length}`);
    console.log(`Мінімум: ${min}`);
    console.log(`Максимум: ${max}`);
    console.log(`Середнє: ${avg.toFixed(2)}`);
  });

const silentOutput = { outputError: () => {} };
program.exitOverride();
program.configureOutput(silentOutput);
program.commands.forEach((cmd) => {
  cmd.exitOverride();
  cmd.configureOutput(silentOutput);
});

try {
  program.parse(process.argv);
} catch (err) {
  switch (err.code) {
    case "commander.helpDisplayed":
    case "commander.version":
      process.exit(0);
      break;
    case "commander.missingArgument":
      console.error("Помилка: не вказано обов'язковий аргумент команди.");
      process.exit(1);
      break;
    case "commander.unknownOption":
      console.error("Помилка: невідома опція командного рядка.");
      process.exit(1);
      break;
    case "commander.invalidArgument": {
      const parts = err.message.split(". ");
      const customPart = parts[parts.length - 1];
      console.error(`Помилка: некоректне значення опції. ${customPart}`);
      process.exit(1);
      break;
    }
    default:
      console.error(`Помилка виконання програми: ${err.message}`);
      process.exit(1);
  }
}