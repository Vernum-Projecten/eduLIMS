- A finished simulation takes no new students and no moves: finishing it turns off its labs' join
  codes for good, and the Student portal overview shows a sentence in place of the join form while the
  student's simulation is unfinished (S10). The migration `0026_one_active_simulation_per_student`
  now stops when existing data already puts a student in two unfinished simulations.
