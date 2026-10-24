# Salon API

## Prerequisites

- Node.js 20 or newer.
- npm, which is included with Node.js.
- The dependencies declared in `package.json`: Express, Mongoose, JSON Web Token, bcryptjs, CORS, dotenv, and SuperTest. Development and test tooling includes TypeScript, Jest, Babel-Jest, tsx, and `mongodb-memory-server`; `npm install` installs all of them.
- Internet access for the initial `npm install` and, when tests are run for the first time, for `mongodb-memory-server` to download its MongoDB binary.
- A MongoDB instance is required only when running the application or the database seeder. A local MongoDB instance is expected by default, or an externally hosted MongoDB connection can be provided through `MONGO_URI`.

## Environment Setup

From this directory, install the dependencies:

```bash
npm install
```

Create a `.env` file in the `Jest-assignment` directory if you want to override the development defaults:

```env
PORT=3000
MONGO_URI=mongodb://localhost:27017/salon-db
JWT_SECRET=replace-with-a-long-random-secret
```

Environment variables:

- `PORT` - HTTP port used by the application. Defaults to `3000`.
- `MONGO_URI` - MongoDB connection string used by the application and `utils/seed.ts`. Defaults to `mongodb://localhost:27017/salon-db`.
- `JWT_SECRET` - Secret used to sign and verify authentication tokens. The code has a development fallback, but a strong explicit value should be configured outside local development.

The application loads `.env` through `dotenv`. Do not commit `.env` or production secrets. To run the server against the default local database:

```bash
npm run dev
```

For a compiled run:

```bash
npm run build
npm start
```

If the database needs sample data, make sure MongoDB is running and execute the seeder with the TypeScript runner:

```bash
npx tsx utils/seed.ts
```

The seeder clears the existing salon database before inserting its sample users, salon, services, and bookings. Use it only against a development database.

## Run Tests

Run the Jest end-to-end suite in serial mode:

```bash
npm test
```

The project also provides:

```bash
npm run test:watch
```

### Test configuration and lifecycle

- Jest runs in the Node environment and discovers tests under `tests/`.
- TypeScript test and source files are transformed by `babel-jest` using `@babel/preset-typescript` and the CommonJS transform plugin.
- `clearMocks` is enabled in the Jest configuration.
- `tests/api.e2e.test.ts` starts an isolated `MongoMemoryServer` in `beforeAll`, connects Mongoose to it, and creates the required stylist, salon, and service fixtures.
- Each test clears bookings and customer users in `afterEach`.
- `afterAll` disconnects Mongoose and stops the in-memory MongoDB server.
- No external MongoDB service or pre-seeded database is needed for the Jest suite. The first run may take longer while the in-memory MongoDB binary is downloaded.

These instructions assume npm is used as the package manager, the checked-in `package-lock.json` is retained, and the test suite is run from the `Jest-assignment` directory.
