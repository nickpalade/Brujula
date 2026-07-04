.PHONY: bootstrap install serve verify

bootstrap:
	bash bootstrap.sh

install:
	npm install

serve:
	npm start

verify:
	npm run verify
