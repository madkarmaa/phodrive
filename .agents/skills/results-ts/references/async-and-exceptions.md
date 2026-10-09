# Async chains and exception boundaries

## Choose the callback and return type

| Callback returns                                        | Use            | Result                          |
| ------------------------------------------------------- | -------------- | ------------------------------- |
| `U`                                                     | `map`          | Result or Option of U           |
| `Result<U, F>` or `Option<U>`                           | `andThen`      | A flat container                |
| `PromiseLike<U>`                                        | `mapAsync`     | AsyncResult or AsyncOption of U |
| `PromiseLike<Result<U, F>>` or `PromiseLike<Option<U>>` | `andThenAsync` | A flat async wrapper            |

Use async methods when the callback is async, even on an existing async wrapper. `map(async ...)` leaves a Promise in the payload. Use `filterAsync` for async Option predicates. Use `inspectAsync` for async effects and `inspectErrAsync` for effects on Result errors.

Return `AsyncResult<T, E>` or `AsyncOption<T>` so callers can chain methods before awaiting. Return the wrapper from an ordinary function. An `async` function returns a native Promise and loses the wrapper's methods. AsyncResult and AsyncOption satisfy the PromiseLike callback types in the table.

Awaiting `AsyncResult<T, E>` yields `Result<T, E>`. Awaiting `AsyncOption<T>` yields `Option<T>`. Methods that transform values return wrappers you can keep chaining. Methods such as `match`, `unwrapOr`, and `isOk` return native promises. Await them to get their values. Async predicates do not narrow the container's type. Await the container first if you need synchronous type narrowing.

```typescript
import { Err, Ok, type AsyncResult, type Result } from 'results-ts';

type User = { readonly id: number; readonly name: string };
type LoadError = { readonly code: 'NOT_FOUND'; readonly id: number };

const loadUser = (id: number): AsyncResult<User, LoadError> =>
    Ok(id).andThenAsync(async (value) => {
        const result: Result<User, LoadError> =
            value === 1 ? Ok({ id: value, name: 'Ada' }) : Err({ code: 'NOT_FOUND', id: value });
        return result;
    });

const name = await Ok(1)
    .andThenAsync(loadUser)
    .map((user) => user.name)
    .match({
        Ok: (value) => value,
        Err: (error) => `Missing user ${error.id}`
    });
// name is 'Ada'.
```

If a dependency returns `Promise<Result<T, E>>` or `Promise<Option<T>>`, await it before chaining or call its function through `andThenAsync`. Return AsyncResult or AsyncOption from new application APIs. These wrappers implement `PromiseLike` and have no native `.catch` or `.finally` methods. Use `await` with `try`/`catch`, or `Promise.resolve(wrapper)` if you need a native Promise.

If TypeScript infers only one error variant from a callback, annotate its Result return type or supply the method's success and error types. For example, use `andThenAsync<User, LoadError>` for those callback output types. Keep the full error union. Do not cast branches to silence the error.

## Reserve exception adapters for unavoidable external failures

Avoid `catchUnwind` and `catchUnwindAsync`. Use one only when an external operation throws or rejects, you cannot change that behavior, and no suitable nonthrowing or Result-returning API exists. Some Node APIs require this exception.

Code the project controls must return Result or AsyncResult with explicit Ok and Err variants. Return Err for HTTP status failures and invalid input. Never throw an error to capture it in an adapter. Do not wrap ordinary application pipelines or use an adapter just to create an AsyncResult.

This follows [Rust's recommendation](https://doc.rust-lang.org/std/panic/fn.catch_unwind.html) to use Result for regular failures rather than catch_unwind as a general try/catch mechanism.

Wrap only the external operation that can throw or reject. Validate input and handle expected failures outside the adapter.

`catchUnwind(fn, onThrow?)` returns a function that produces Result when called. `catchUnwindAsync(fn, onThrow?)` returns a function that produces AsyncResult and captures synchronous throws and rejections.

Without `onThrow`, the error type is `unknown`. If supplied, this handler receives `(thrown, ...originalArgs)` and returns the error payload. The handler must be synchronous. Its own exceptions still throw or reject.

Keep `JSON.parse` and `response.json()` results typed as `unknown` until runtime validation succeeds. Their built-in declarations do not validate a domain type. Give parsing adapters an explicit `unknown` or `Promise<unknown>` return type.

## Rejections and operand evaluation

An Err is a failure value, not a rejection. `mapErr`, `orElse`, and the Err handler in `match` handle only that value. They do not catch callback exceptions, rejected operands, or panics from `unwrap`.

`Result.and` and `Result.or` accept PromiseLike operands and return AsyncResult for them. Option's `and`, `or`, `xor`, and `zip` return AsyncOption for PromiseLike operands. These methods resolve the operand even when they do not use its value. Its rejections propagate. On async wrappers, the receiver and async operand resolve concurrently. Use `andThenAsync` or `orElseAsync` to start an operation only for the selected variant.

Read the async and error-handling sections in [llms.txt](https://results-ts.madkarma.top/llms.txt). Check installed declarations for available overloads.
