update:	
	ssh ubuntu@poleopinii "bin/update poleopinii"
	./list.sh *.js  routes tools views public > list.txt
%:	
	git add .
	git commit -m "$@"
	git push
