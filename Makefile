.PHONY: bootstrap install serve dev build lint test verify

bootstrap:
	bash bootstrap.sh

install:
	npm install

serve:
	npm start

dev:
	npm run dev:all

build:
	npm run build

lint:
	npm run lint

test:
	npm run test:e2e

verify:
	npm run verify
