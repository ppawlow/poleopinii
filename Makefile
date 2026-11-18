update:	
	ssh ubuntu@poleopinii "bin/update poleopinii"
%:	
	git add .
	git commit -m "$@"
	git push
