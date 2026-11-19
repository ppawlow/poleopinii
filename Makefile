list:	
	./list.sh *.js  routes tools views public > list.txt

update:	list
	ssh ubuntu@poleopinii "bin/update poleopinii"
	
%:	list
	git add .
	git commit -m "$@"
	git push
