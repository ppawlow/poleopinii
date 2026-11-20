.PHONY:	list update

list:	
	./list.sh *.js  routes tools views public > list.txt
	exit
update:	
	ssh ubuntu@poleopinii "bin/update poleopinii"
	exit
%:	list
	git add .
	git commit -m "$@"
	git push
