.PHONY: list update
Makefile: ;

list:	
	./list.sh *.js  routes tools views public > list.txt

update:	
	ssh ubuntu@poleopinii "bin/update poleopinii"

%:	list
	git add .
	git commit -m "$@"
	git push
