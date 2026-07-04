.PHONY: bootstrap install serve verify verify-agent

bootstrap:
	bash bootstrap.sh

install:
	npm install

serve:
	npm start

verify:
	npm run verify

verify-agent:
	npm run verify:agent
