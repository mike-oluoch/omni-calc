"use strict";

const $ = (selector) => document.querySelector(selector);
const expressionDisplay = $("#expression");
const resultDisplay = $("#result");
const statusDisplay = $("#status");
const scientificKeys = $("#scientific-keys");
const historyList = $("#history-list");

let expression = "";
let lastAnswer = 0;
let degreeMode = true;
let scientificMode = false;
let justCalculated = false;
let calculationHistory = [];

const FUNCTIONS = new Set(["sin", "cos", "tan", "log", "ln", "sqrt"]);
const OPERATORS = ["+", "-", "×", "÷", "^", "%", "!"];

function setStatus(message, isError = false) {
  statusDisplay.textContent = message;
  statusDisplay.classList.toggle("error", isError);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) throw new Error("Result is not finite.");
  if (Object.is(value, -0)) value = 0;

  if (Math.abs(value) >= 1e12 || (Math.abs(value) > 0 && Math.abs(value) < 1e-7)) {
    return value.toExponential(7).replace(/\.?0+e/, "e");
  }

  return Number(value.toPrecision(12)).toLocaleString("en-US", {
    useGrouping: true,
    maximumFractionDigits: 10
  });
}

function normalizedExpression(input) {
  return input
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-");
}

function tokenize(input) {
  const source = normalizedExpression(input);
  const tokens = [];
  let i = 0;

  while (i < source.length) {
    const rest = source.slice(i);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      i += whitespace[0].length;
      continue;
    }

    const number = rest.match(/^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new Error("Invalid number.");
      tokens.push({ type: "number", value });
      i += number[0].length;
      continue;
    }

    const identifier = rest.match(/^[a-zA-Z]+/);
    if (identifier) {
      const name = identifier[0].toLowerCase();
      if (FUNCTIONS.has(name)) {
        tokens.push({ type: "function", value: name });
      } else if (name === "pi") {
        tokens.push({ type: "number", value: Math.PI });
      } else if (name === "e") {
        tokens.push({ type: "number", value: Math.E });
      } else if (name === "ans") {
        tokens.push({ type: "number", value: lastAnswer });
      } else {
        throw new Error(`Unknown function or constant: ${name}`);
      }
      i += identifier[0].length;
      continue;
    }

    if ("+-*/^()%!".includes(source[i])) {
      tokens.push({ type: "operator", value: source[i] });
      i++;
      continue;
    }

    throw new Error(`Unexpected character: ${source[i]}`);
  }

  if (tokens.length > 300) throw new Error("Expression is too long.");
  if (!tokens.length) throw new Error("Enter a calculation first.");

  // Support implicit multiplication: 2π, 2(3+4), and (2)(3).
  const expanded = [];
  const endsValue = (t) =>
    t.type === "number" || (t.type === "operator" && [")", "!", "%"].includes(t.value));
  const startsValue = (t) =>
    t.type === "number" || t.type === "function" ||
    (t.type === "operator" && t.value === "(");

  for (const token of tokens) {
    const previous = expanded[expanded.length - 1];
    if (previous && endsValue(previous) && startsValue(token)) {
      expanded.push({ type: "operator", value: "*" });
    }
    expanded.push(token);
  }

  return expanded;
}

function calculate(input) {
  const tokens = tokenize(input);
  let position = 0;
  let operations = 0;

  const peek = () => tokens[position];
  const consume = () => tokens[position++];

  function guard(value) {
    operations++;
    if (operations > 500) throw new Error("Expression is too complex.");
    if (!Number.isFinite(value)) throw new Error("Math error: result is not finite.");
    if (Math.abs(value) > 1e100) throw new Error("Result is too large.");
    return value;
  }

  function factorial(n) {
    if (!Number.isInteger(n) || n < 0 || n > 170) {
      throw new Error("Factorial requires an integer from 0 to 170.");
    }
    let answer = 1;
    for (let k = 2; k <= n; k++) answer *= k;
    return guard(answer);
  }

  // Grammar: expression -> sum; sum -> product; product -> unary;
  // unary -> +/- unary | power; power -> postfix ^ unary.
  // This makes -2^2 equal -4 and allows 2^-2.
  function sum() {
    let value = product();
    while (peek() && ["+", "-"].includes(peek().value)) {
      const op = consume().value;
      const right = product();
      value = guard(op === "+" ? value + right : value - right);
    }
    return value;
  }

  function product() {
    let value = unary();
    while (peek() && ["*", "/"].includes(peek().value)) {
      const op = consume().value;
      const right = unary();
      if (op === "/" && right === 0) throw new Error("Cannot divide by zero.");
      value = guard(op === "*" ? value * right : value / right);
    }
    return value;
  }

  function unary() {
    if (peek() && ["+", "-"].includes(peek().value)) {
      const op = consume().value;
      const value = unary();
      return op === "-" ? guard(-value) : value;
    }
    return power();
  }

  function power() {
    let value = postfix();
    if (peek() && peek().value === "^") {
      consume();
      value = guard(Math.pow(value, unary()));
    }
    return value;
  }

  function postfix() {
    let value = primary();
    while (peek() && ["!", "%"].includes(peek().value)) {
      const op = consume().value;
      value = op === "!" ? factorial(value) : guard(value / 100);
    }
    return value;
  }

  function primary() {
    const token = consume();
    if (!token) throw new Error("Incomplete expression.");

    if (token.type === "number") return token.value;

    if (token.type === "function") {
      const value = unary();
      let result;

      switch (token.value) {
        case "sin":
          result = Math.sin(degreeMode ? value * Math.PI / 180 : value);
          break;
        case "cos":
          result = Math.cos(degreeMode ? value * Math.PI / 180 : value);
          break;
        case "tan": {
          const angle = degreeMode ? value * Math.PI / 180 : value;
          if (Math.abs(Math.cos(angle)) < 1e-12) {
            throw new Error("Tangent is undefined at this angle.");
          }
          result = Math.tan(angle);
          break;
        }
        case "log":
          if (value <= 0) throw new Error("Logarithm requires a positive number.");
          result = Math.log10(value);
          break;
        case "ln":
          if (value <= 0) throw new Error("Natural log requires a positive number.");
          result = Math.log(value);
          break;
        case "sqrt":
          if (value < 0) throw new Error("Cannot take the square root of a negative number.");
          result = Math.sqrt(value);
          break;
        default:
          throw new Error("Unsupported function.");
      }
      return guard(result);
    }

    if (token.value === "(") {
      const value = sum();
      if (!peek() || consume().value !== ")") {
        throw new Error("Missing closing parenthesis.");
      }
      return value;
    }

    throw new Error("Expected a number or mathematical function.");
  }

  const answer = sum();
  if (position !== tokens.length) throw new Error("Check your expression.");
  return guard(answer);
}

function render() {
  expressionDisplay.textContent = expression || " ";
  $("#mode-label").textContent = scientificMode ? "SCIENTIFIC MODE" : "STANDARD MODE";
  $("#angle-label").textContent = scientificMode ? (degreeMode ? "DEG" : "RAD") : "";
  $("#angle-toggle").textContent = degreeMode ? "DEG" : "RAD";
  $("#mode-toggle").setAttribute("aria-pressed", String(scientificMode));

  if (!expression) {
    resultDisplay.textContent = "0";
    return;
  }

  try {
    resultDisplay.textContent = formatNumber(calculate(expression));
  } catch {
    resultDisplay.textContent = "…";
  }
}

function append(value) {
  const startsNew = ["+", "-", "×", "÷", "^", "%", "!"].includes(value);

  if (justCalculated && !startsNew && value !== ")") {
    expression = "";
  }
  justCalculated = false;

  if (value === "Ans") value = "Ans";
  expression += value;
  setStatus("Calculation in progress");
  render();
}

function clearAll() {
  expression = "";
  justCalculated = false;
  resultDisplay.textContent = "0";
  setStatus("Ready for your next calculation");
  render();
}

function deleteLast() {
  if (justCalculated) {
    clearAll();
    return;
  }
  expression = expression.slice(0, -1);
  setStatus(" ");
  render();
}

function toggleSign() {
  if (!expression) {
    expression = "-";
  } else {
    expression = `-(${expression})`;
  }
  justCalculated = false;
  render();
}

function renderHistory() {
  historyList.replaceChildren();

  if (!calculationHistory.length) {
    const empty = document.createElement("p");
    empty.className = "empty-history";
    empty.textContent = "Your calculations will appear here.";
    historyList.append(empty);
    return;
  }

  calculationHistory.forEach((item) => {
    const button = document.createElement("button");
    button.className = "history-item";
    button.type = "button";

    const expr = document.createElement("div");
    expr.className = "history-expression";
    expr.textContent = item.expression;

    const result = document.createElement("div");
    result.className = "history-result";
    result.textContent = item.result;

    const time = document.createElement("div");
    time.className = "history-time";
    time.textContent = item.time;

    button.append(expr, result, time);
    button.addEventListener("click", () => {
      expression = String(item.answer);
      lastAnswer = item.answer;
      justCalculated = true;
      render();
      setStatus("Previous result restored");
    });
    historyList.append(button);
  });
}

function equals() {
  if (!expression.trim()) return;

  try {
    const answer = calculate(expression);
    const original = expression;
    const formatted = formatNumber(answer);

    lastAnswer = answer;
    calculationHistory.unshift({
      expression: original,
      answer,
      result: formatted,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      })
    });
    calculationHistory = calculationHistory.slice(0, 30);
    renderHistory();

    expression = String(answer);
    resultDisplay.textContent = formatted;
    expressionDisplay.textContent = `${original} =`;
    justCalculated = true;
    setStatus("Calculation complete");
  } catch (error) {
    setStatus(error.message || "Unable to calculate this expression.", true);
  }
}

document.querySelectorAll("[data-value]").forEach((button) => {
  button.addEventListener("click", () => append(button.dataset.value));
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => {
    switch (button.dataset.action) {
      case "clear": clearAll(); break;
      case "delete": deleteLast(); break;
      case "equals": equals(); break;
      case "sign": toggleSign(); break;
      case "angle":
        degreeMode = !degreeMode;
        render();
        setStatus(degreeMode ? "Angles in degrees" : "Angles in radians");
        break;
    }
  });
});

document.querySelectorAll("[data-fn]").forEach((button) => {
  button.addEventListener("click", () => {
    const fn = button.dataset.fn;
    const value = expression;
    expression = `${fn}(${value})`;
    justCalculated = false;
    render();
  });
});

$("#mode-toggle").addEventListener("click", () => {
  scientificMode = !scientificMode;
  scientificKeys.classList.toggle("hidden", !scientificMode);
  render();
});

$("#theme-toggle").addEventListener("click", () => {
  const isLight = document.body.classList.toggle("light");
  document.querySelector('meta[name="theme-color"]')
    .setAttribute("content", isLight ? "#eef2fa" : "#111827");
});

$("#history-toggle").addEventListener("click", () => {
  const panel = $("#history-panel");
  panel.hidden = !panel.hidden;
});

$("#clear-history").addEventListener("click", () => {
  calculationHistory = [];
  renderHistory();
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;

  if (/^[0-9.]$/.test(event.key)) append(event.key);
  else if (event.key === "*") append("×");
  else if (event.key === "/") {
    event.preventDefault();
    append("÷");
  } else if (["+", "-", "^", "(", ")", "%", "!"].includes(event.key)) append(event.key);
  else if (event.key === "Enter" || event.key === "=") {
    event.preventDefault();
    equals();
  } else if (event.key === "Backspace") deleteLast();
  else if (event.key === "Escape") clearAll();
});

render();
renderHistory();