---
name: results-ts
description: Write and review TypeScript code that uses results-ts, including Result and Option pipelines, typed errors, and AsyncResult or AsyncOption chains.
license: MIT
---

# Use results-ts

Check the project's installed `results-ts` version and declarations before using a method. These examples use v4 APIs. Follow the installed declarations if the version differs. Keep the project's error model and change only the requested code.

Install with `bun add results-ts` if needed, or use the project's existing package manager. Import values and types from `results-ts`. Implementation classes and error classes are private.

Return `AsyncResult<T, E>` or `AsyncOption<T>` from APIs that produce async containers. Return the wrapper from an ordinary function. Adding `async` makes the function return a native Promise, so callers lose the wrapper's methods. Use native promises of containers only to work with an existing dependency.

## Choose the operation

| Intent                                         | Use                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| Return a value or a recoverable error          | `Ok(value)` / `Err(error)`, typed as `Result<T, E>`                  |
| Represent presence or absence without an error | `Some(value)` / `None<T>()`, typed as `Option<T>`                    |
| Transform a success or present value           | `map`                                                                |
| Chain a function returning a Result or Option  | `andThen`                                                            |
| Transform a Result error                       | `mapErr`                                                             |
| Recover with another Result or Option          | `orElse`                                                             |
| Handle both variants at a boundary             | `match({ Ok, Err })` / `match({ Some, None })`                       |
| Compute a fallback only when needed            | `unwrapOrElse` / `mapOrElse`                                         |
| Observe without replacing the value            | `inspect` / `inspectErr` for Result errors                           |
| Convert absence to an error                    | `okOr(error)` / `okOrElse(() => error)`                              |
| Convert a Result to an Option                  | `ok()` for success / `err()` for error, discarding the other variant |

`map` wraps its callback's return value. Use `andThen` when the callback returns a Result or Option to avoid nesting. Result chaining preserves the union of error types. `orElse` replaces the error type with the recovery function's error type.

## Keep failures typed

Return Result or AsyncResult for operations that can fail. Code you control must return Err for recoverable failures. Do not throw an error just to capture it in a container. Use discriminated unions for application errors and narrow unknown input before treating it as a domain type. Avoid `any` and casts that hide mismatched success or error types.

Avoid `catchUnwind` and `catchUnwindAsync`. Use them only when a dependency throws or rejects, you cannot change that behavior, and no suitable nonthrowing or Result-returning API exists. Some Node APIs require this exception. Do not use these adapters for routine failures, general try/catch, or creating an AsyncResult.

```typescript
import { Err, Ok, type Result } from 'results-ts';

type IdError = { readonly code: 'INVALID_ID'; readonly input: string };

const parseId = (input: string): Result<number, IdError> => {
    const id = Number(input);
    return Number.isSafeInteger(id) && id > 0 ? Ok(id) : Err({ code: 'INVALID_ID', input });
};

const message = parseId('42')
    .map((id) => id + 1)
    .match({
        Ok: (id) => `ID: ${id}`,
        Err: (error) => `Invalid ID: ${error.input}`
    });
// message is 'ID: 43'.
```

Use `match` or fallbacks for recoverable outcomes. `unwrap` and `expect` throw on Err or None. `unwrapErr` and `expectErr` throw on Ok. Use these methods only when that variant would indicate a bug. Access payloads through methods. The library has no public `.value` or `.error` properties.

## Avoid eager work and uncaught failures

- JavaScript evaluates arguments to `and`, `or`, `unwrapOr`, `mapOr`, and `okOr` before calling the method. Use callback alternatives when work should run only for the selected variant.
- Callback exceptions propagate. Ordinary chains do not convert throws or promise rejections to Err.
- `AsyncResult` and `AsyncOption` are exported types, not constructors. Create wrappers through async methods.
- Option methods such as `insert`, `take`, and `replace` mutate the receiver.

## Read details for the task

- For async chains, existing Promise APIs, or unavoidable external exceptions, read [async and exceptions](references/async-and-exceptions.md).
- For nullish input, Option mutation, nested containers, or tuples, read [Option and composition](references/option-and-composition.md).

Read [llms.txt](https://results-ts.madkarma.top/llms.txt) for online guides and API details instead of the website's HTML. Check signatures against the project's installed declarations.

In the library repository, verify exports and behavior in `src/index.ts`, `src/result.ts`, `src/option.ts`, `src/async-result.ts`, and `src/async-option.ts`. Consuming projects need not contain these source files.

Run the project's typecheck and tests for the changed code. Test both variants. For async code, test Err values and rejected operations separately.
