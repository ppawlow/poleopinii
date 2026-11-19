list:	
	./list.sh *.js  routes tools views public > list.txt

update:	list
	ssh ubuntu@poleopinii "bin/update poleopinii"
%:	
	git add .
	git commit -m "$@"
	git push
